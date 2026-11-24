"""v2 endpoints: coupon desk lookup, global search, filtered lists and period dashboards."""
from collections import defaultdict
from datetime import timedelta

from django.db.models import Count, Exists, F, OuterRef, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .auth import NotSupervisor
from .errors import Rule
from .helpers import d, issue_status, read_club
from .models import (Allocation, Club, Coach, CouponIssue, CouponUnit, Customer, CvcMembership, PasswordResetRequest,
                     PrintBatch, Redemption, ReferralVisit, Trial, User, WeeklyResult)


def _need_club(request):
    club = read_club(request)
    if not club:
        raise Rule("Choose a club first.")
    return club


# =====================================================================  COUPON DESK
def _visit_days(v):
    return {r.day: r for r in v.redemptions.all() if not r.is_void}


def _person_next(c):
    """Where a visitor stands after Day 2: trial / CVC."""
    if hasattr(c, "cvc"):
        return "cvc"
    t = c.trial if hasattr(c, "trial") else None
    if t:
        return "trial_done" if t.is_completed else "in_trial"
    if Trial.objects.filter(customer__mobile=c.mobile).exists():
        return "trial_elsewhere"
    return "none"


def _desk_unit(unit, club, user):
    today = timezone.localdate()
    b = unit.batch
    base = {"unit": unit.id, "batch": b.code, "color": b.color, "number": unit.number, "label": unit.label(), "valid_days": b.valid_days}
    if unit.status == "ALLOCATED":
        return {**base, "state": "stock", "expires_if_issued_today": d(today + timedelta(days=b.valid_days))}
    i = CouponIssue.objects.select_related("customer", "coach").get(unit=unit)
    out = {**base, "issue": i.id, "holder": i.customer.name, "holder_id": i.customer_id, "holder_mobile": i.customer.mobile,
           "purpose": i.get_purpose_display(), "coach": i.coach.name, "coach_id": i.coach_id, "issued_at": d(i.created_at),
           "expires_on": d(i.expires_on), "paused": i.is_paused, "pause_reason": i.pause_reason, "status": issue_status(i),
           "can_undo": not hasattr(i, "visit")}
    v = i.visit if hasattr(i, "visit") else None
    if v:
        days = _visit_days(v)
        out.update({"visit": v.id, "visitor": v.visitor.name, "visitor_id": v.visitor_id, "visitor_mobile": v.visitor.mobile,
                    "visit_coach": v.coach.name,
                    "days": [{"id": r.id, "day": r.day, "at": d(r.created_at), "created_by": r.created_by_id} for r in days.values()]})
        if 2 in days:
            out["state"] = "done"
            out["next"] = _person_next(v.visitor)
        elif i.is_expired:
            out["state"] = "expired"
        elif 1 in days:
            d1 = timezone.localtime(days[1].created_at).date()
            out["state"] = "d1"
            out["d2_opens"] = d((d1 + timedelta(days=1)))
            out["can_d2"] = d1 < today and not i.is_paused
        else:
            out["state"] = "registered"
    elif i.is_paused:
        out["state"] = "paused"
    elif i.is_expired:
        out["state"] = "expired"
    else:
        out["state"] = "waiting"
    return out


@api_view(["GET"])
def desk(request):
    """What is coupon #N in this club, and what's the next step?"""
    club = _need_club(request)
    try:
        n = int(str(request.query_params.get("number", "")).lstrip("#"))
    except ValueError:
        raise Rule("Type the number printed on the coupon.")
    units = list(CouponUnit.objects.filter(club=club, number=n).select_related("batch").order_by("batch__code"))
    bid = request.query_params.get("batch")
    if bid:
        units = [u for u in units if str(u.batch_id) == str(bid) or u.batch.code == bid]
    if not units:
        other = CouponUnit.objects.filter(number=n, club__isnull=False).exclude(club=club).select_related("club", "batch").first()
        if other:
            return Response({"state": "other", "number": n, "club": other.club.name, "label": other.label()})
        return Response({"state": "missing", "number": n})
    if len(units) > 1:
        return Response({"state": "choose", "number": n, "choices": [{"batch_id": u.batch_id, "batch": u.batch.code, "color": u.batch.color,
                                                                       "status": "In stock" if u.status == "ALLOCATED" else "Issued"} for u in units]})
    return Response(_desk_unit(units[0], club, request.user))


# =====================================================================  SEARCH
def _stage_annotations(qs):
    return qs.annotate(is_visitor=Exists(ReferralVisit.objects.filter(visitor=OuterRef("pk"))))


def _stage_q(stage):
    no_member = Q(cvc__isnull=True)
    done = Q(trial__day1=True, trial__day2=True, trial__day3=True)
    return {
        "CVC member": Q(cvc__isnull=False),
        "Trial done": no_member & done,
        "In trial": no_member & Q(trial__isnull=False) & ~done,
        "Visitor": no_member & Q(trial__isnull=True, is_visitor=True),
        "New": no_member & Q(trial__isnull=True, is_visitor=False),
    }.get(stage)


def _stage(c):
    if hasattr(c, "cvc"):
        return "CVC member"
    t = c.trial if hasattr(c, "trial") else None
    if t:
        return "Trial done" if t.is_completed else "In trial"
    return "Visitor" if getattr(c, "is_visitor", False) else "New"


def _cust_row(c, admin):
    return {"id": c.id, "name": c.name, "mobile": c.mobile, "stage": _stage(c), "coach": c.coach.name if c.coach else None,
            "coach_id": c.coach_id, "joined": d(c.created_at), "invited": getattr(c, "invited", None),
            "club": c.club.name if admin else None, "club_id": c.club_id}


def _text_q(q, *fields):
    digits = "".join(ch for ch in q if ch.isdigit())
    cond = Q()
    for f in fields:
        cond |= Q(**{f + "__icontains": q})
        if len(digits) >= 3 and "mobile" in f:
            cond |= Q(**{f + "__contains": digits})
    return cond


@api_view(["GET"])
def search(request):
    q = (request.query_params.get("q") or "").strip()
    if len(q) < 2:
        return Response({"customers": [], "referrals": [], "coaches": [], "counts": {"customers": 0, "referrals": 0, "coaches": 0}})
    club = read_club(request)
    admin = request.user.is_admin and not club
    f = (lambda qs, fld="club": qs.filter(**{fld: club})) if club else (lambda qs, fld="club": qs)
    cust = f(_stage_annotations(Customer.objects.filter(is_deleted=False).select_related("coach", "trial", "cvc", "club")))
    cust = cust.filter(_text_q(q, "name", "mobile"))
    num = q.lstrip("#")
    rq = _text_q(q, "customer__name", "customer__mobile", "visit__visitor__name", "visit__visitor__mobile")
    if num.isdigit():
        rq |= Q(unit__number=int(num))
    refs = f(CouponIssue.objects.select_related("unit__batch", "customer", "coach", "club", "visit__visitor").prefetch_related("visit__redemptions")).filter(rq)
    coaches = f(Coach.objects.select_related("club")).filter(_text_q(q, "name", "mobile", "herbalife_id"))
    return Response({
        "customers": [_cust_row(c, admin) for c in cust[:8]],
        "referrals": [_ref_row(i, admin) for i in refs[:8]],
        "coaches": [{"id": c.id, "name": c.name, "mobile": c.mobile, "herbalife_id": c.herbalife_id, "is_active": c.is_active,
                     "club": c.club.name if admin else None, "club_id": c.club_id} for c in coaches[:8]],
        "counts": {"customers": cust.count(), "referrals": refs.count(), "coaches": coaches.count()},
    })


# =====================================================================  FILTERED LISTS
def _period_start(key):
    today = timezone.localdate()
    return {"week": today - timedelta(days=6), "month": today.replace(day=1), "3m": today - timedelta(days=90)}.get(key)


@api_view(["GET"])
def customer_list(request):
    club = read_club(request)
    admin = request.user.is_admin and not club
    p = request.query_params
    qs = _stage_annotations(Customer.objects.filter(is_deleted=False).select_related("coach", "trial", "cvc", "club"))
    if club:
        qs = qs.filter(club=club)
    if p.get("q"):
        qs = qs.filter(_text_q(p["q"].strip(), "name", "mobile"))
    if p.get("coach"):
        qs = qs.filter(coach_id=p["coach"]) if p["coach"] != "none" else qs.filter(coach__isnull=True)
    start = _period_start(p.get("joined"))
    if start:
        qs = qs.filter(created_at__date__gte=start)
    counts = {"All": qs.count()}
    for s in ("New", "Visitor", "In trial", "Trial done", "CVC member"):
        counts[s] = qs.filter(_stage_q(s)).count()
    if p.get("stage") and _stage_q(p["stage"]) is not None:
        qs = qs.filter(_stage_q(p["stage"]))
    qs = qs.annotate(invited=Count("issues__visit", distinct=True))
    order = {"name": ["name"], "invited": ["-invited", "name"]}.get(p.get("sort"), ["-created_at"])
    total = qs.count()
    page = max(1, int(p.get("page") or 1))
    size = 50
    rows = [_cust_row(c, admin) for c in qs.order_by(*order)[(page - 1) * size: page * size]]
    return Response({"total": total, "counts": counts, "page": page, "pages": max(1, -(-total // size)), "results": rows})


def _ref_row(i, admin):
    v = i.visit if hasattr(i, "visit") else None
    return {"id": i.id, "coupon": i.unit.label(), "number": i.unit.number, "batch": i.unit.batch.code, "holder": i.customer.name,
            "holder_mobile": i.customer.mobile, "visitor": v.visitor.name if v else None, "visitor_mobile": v.visitor.mobile if v else None,
            "status": issue_status(i, v), "coach": i.coach.name, "coach_id": i.coach_id, "issued_at": d(i.created_at),
            "expires_on": d(i.expires_on), "purpose": i.get_purpose_display(), "club": i.club.name if admin else None, "club_id": i.club_id}


REF_STATUSES = ["Waiting", "Friend registered", "Day 1 done", "Day 2 done", "Expired", "Paused"]


@api_view(["GET"])
def referral_list(request):
    club = read_club(request)
    admin = request.user.is_admin and not club
    p = request.query_params
    qs = CouponIssue.objects.select_related("unit__batch", "customer", "coach", "club", "visit__visitor").prefetch_related("visit__redemptions")
    if club:
        qs = qs.filter(club=club)
    if p.get("q"):
        q = p["q"].strip()
        cond = _text_q(q, "customer__name", "customer__mobile", "visit__visitor__name", "visit__visitor__mobile")
        if q.lstrip("#").isdigit():
            cond |= Q(unit__number=int(q.lstrip("#")))
        qs = qs.filter(cond)
    if p.get("coach"):
        qs = qs.filter(coach_id=p["coach"])
    if p.get("batch"):
        qs = qs.filter(unit__batch__code=p["batch"])
    rows = [_ref_row(i, admin) for i in qs[:3000]]
    counts = {"All": len(rows), **{s: 0 for s in REF_STATUSES}}
    for r in rows:
        counts[r["status"]] += 1
    st = p.get("status")
    if st in REF_STATUSES:
        rows = [r for r in rows if r["status"] == st]
    return Response({"total": len(rows), "counts": counts, "results": rows[:300]})


@api_view(["GET"])
def coach_list(request):
    club = read_club(request)
    admin = request.user.is_admin and not club
    p = request.query_params
    qs = Coach.objects.select_related("club")
    if club:
        qs = qs.filter(club=club)
    if p.get("q"):
        qs = qs.filter(_text_q(p["q"].strip(), "name", "mobile", "herbalife_id"))
    counts = {"All": qs.count(), "Active": qs.filter(is_active=True).count(), "Inactive": qs.filter(is_active=False).count()}
    st = p.get("status", "Active")
    if st in ("Active", "Inactive"):
        qs = qs.filter(is_active=(st == "Active"))
    qs = qs.annotate(n_customers=Count("customers", filter=Q(customers__is_deleted=False), distinct=True),
                     n_issued=Count("couponissue", distinct=True),
                     n_trials=Count("customers__trial", distinct=True),
                     n_cvc=Count("customers__cvc", distinct=True))
    order = {"name": ["name"], "issued": ["-n_issued", "name"]}.get(p.get("sort"), ["-n_cvc", "-n_issued", "name"])
    return Response({"counts": counts, "results": [{
        "id": c.id, "name": c.name, "mobile": c.mobile, "herbalife_id": c.herbalife_id, "is_active": c.is_active,
        "upline_name": c.upline_name, "upline_mobile": c.upline_mobile, "upline_herbalife_id": c.upline_herbalife_id,
        "customers": c.n_customers, "issued": c.n_issued, "trials": c.n_trials, "cvc": c.n_cvc, "club": c.club.name if admin else None,
        "club_id": c.club_id} for c in qs.order_by(*order)]})


# =====================================================================  DASHBOARDS
RANGES = {"today": 1, "d7": 7, "d30": 30}


def _period(key):
    today = timezone.localdate()
    if key == "all":
        return None, today, None
    if key == "month":
        start = today.replace(day=1)
        days = (today - start).days + 1
        prev_end = start - timedelta(days=1)
        return start, today, (prev_end.replace(day=1), min(prev_end, prev_end.replace(day=1) + timedelta(days=days - 1)))
    n = RANGES.get(key, 30)
    start = today - timedelta(days=n - 1)
    return start, today, (start - timedelta(days=n), start - timedelta(days=1))


def _between(qs, field, start, end):
    if start:
        qs = qs.filter(**{f"{field}__date__gte": start})
    if end:
        qs = qs.filter(**{f"{field}__date__lte": end})
    return qs


def _metrics(club_q, start, end):
    reds = _between(Redemption.objects.filter(is_void=False, **club_q), "created_at", start, end)
    trials = Trial.objects.filter(**club_q)
    return {
        "issued": _between(CouponIssue.objects.filter(**club_q), "created_at", start, end).count(),
        "visits": _between(ReferralVisit.objects.filter(**club_q), "created_at", start, end).count(),
        "d1": reds.filter(day=1).count(), "d2": reds.filter(day=2).count(),
        "trials": _between(trials, "created_at", start, end).count(),
        "trials_done": _between(trials.filter(completed_at__isnull=False), "completed_at", start, end).count(),
        "cvc": _between(CvcMembership.objects.filter(**club_q), "created_at", start, end).count(),
    }


def _delta(now, before):
    if not before:
        return None
    return round((now - before) / before * 100)


def _spark(club_q, start, end):
    """12 equal buckets across the period (or the last 12 days / weeks)."""
    today = timezone.localdate()
    if start is None:
        step, first = 7, today - timedelta(days=7 * 12 - 1)
    else:
        length = (end - start).days + 1
        if length < 12:
            step, first = 1, today - timedelta(days=11)
        else:
            step = length / 12
            first = start
    edges = [first + timedelta(days=round(step * k)) for k in range(13)]
    out = {"visits": [0] * 12, "d2": [0] * 12, "trials": [0] * 12, "cvc": [0] * 12}

    def put(key, dates):
        for dt in dates:
            dt = timezone.localtime(dt).date()
            for k in range(12):
                if edges[k] <= dt < edges[k + 1] or (k == 11 and dt >= edges[11]):
                    out[key][k] += 1
                    break
    put("visits", ReferralVisit.objects.filter(created_at__date__gte=first, **club_q).values_list("created_at", flat=True))
    put("d2", Redemption.objects.filter(day=2, is_void=False, created_at__date__gte=first, **club_q).values_list("created_at", flat=True))
    put("trials", Trial.objects.filter(created_at__date__gte=first, **club_q).values_list("created_at", flat=True))
    put("cvc", CvcMembership.objects.filter(created_at__date__gte=first, **club_q).values_list("created_at", flat=True))
    return out


def _top_inviters(club_q, start, end, admin):
    visits = _between(ReferralVisit.objects.filter(**club_q), "created_at", start, end).select_related("issue__customer", "visitor", "club")
    agg = defaultdict(lambda: {"friends": 0, "converted": 0})
    for v in visits:
        k = (v.issue.customer_id, v.issue.customer.name, v.club.name)
        agg[k]["friends"] += 1
        if hasattr(v.visitor, "trial") or hasattr(v.visitor, "cvc"):
            agg[k]["converted"] += 1
    rows = sorted(agg.items(), key=lambda x: (-x[1]["friends"], -x[1]["converted"]))[:5]
    return [{"id": k[0], "name": k[1], "club": k[2] if admin else None, **val} for k, val in rows]


def _coach_rank(club, start, end):
    rows = []
    for c in Coach.objects.filter(club=club, is_active=True):
        rows.append({"id": c.id, "name": c.name, "issued": _between(CouponIssue.objects.filter(coach=c), "created_at", start, end).count(),
                     "trials": _between(Trial.objects.filter(customer__coach=c), "created_at", start, end).count(),
                     "cvc": _between(CvcMembership.objects.filter(customer__coach=c), "created_at", start, end).count()})
    rows.sort(key=lambda r: (-r["cvc"], -r["trials"], -r["issued"]))
    return rows


def _today(club):
    today = timezone.localdate()
    monday = today - timedelta(days=today.weekday())
    visits = (ReferralVisit.objects.filter(club=club, issue__is_paused=False).filter(Q(issue__expires_on__isnull=True) | Q(issue__expires_on__gte=today))
              .select_related("visitor", "issue__unit__batch").prefetch_related("redemptions"))
    d2_due = []
    for v in visits.filter(redemptions__day=1, redemptions__is_void=False).distinct():
        days = _visit_days(v)
        if 1 in days and 2 not in days and timezone.localtime(days[1].created_at).date() < today:
            d2_due.append({"name": v.visitor.name, "coupon": v.issue.unit.label(), "number": v.issue.unit.number, "batch_id": v.issue.unit.batch_id,
                           "day1": d(days[1].created_at)})
    in_trial = Trial.objects.filter(club=club, completed_at__isnull=True, created_at__date__gte=today - timedelta(days=14)).select_related("customer")
    cvc_ids = CvcMembership.objects.filter(club=club).values_list("customer_id", flat=True)
    done_week = WeeklyResult.objects.filter(club=club, week_start=monday).values_list("customer_id", flat=True)
    weekly_due = Customer.objects.filter(pk__in=cvc_ids, is_deleted=False).exclude(pk__in=done_week).order_by("name")
    expiring = CouponIssue.objects.filter(club=club, visit__isnull=True, is_paused=False, expires_on__gte=today, expires_on__lte=today + timedelta(days=7))
    return {
        "d2_due": d2_due[:20],
        "trials": [{"id": t.id, "name": t.customer.name, "days": [t.day1, t.day2, t.day3]} for t in in_trial[:20]],
        "weekly_due": {"count": weekly_due.count(), "names": [c.name for c in weekly_due[:4]]},
        "expiring": expiring.count(),
    }


def _stock_info(club):
    stock = CouponUnit.objects.filter(club=club, status="ALLOCATED").count()
    last30 = CouponIssue.objects.filter(club=club, created_at__date__gte=timezone.localdate() - timedelta(days=29)).count()
    per_day = last30 / 30
    return {"stock": stock, "days_left": round(stock / per_day) if per_day else None, "issued_30": last30}


def _setup(club):
    owner = club.staff.filter(role="OWNER", is_active=True).first()
    owner_ok = bool(owner or club.admin_owner_id)
    logged_in = bool(club.admin_owner_id or (owner and owner.last_login))
    steps = [
        {"key": "owner", "label": "Club Owner login created", "done": owner_ok,
         "hint": (owner.get_full_name() or owner.username) if owner else (club.admin_owner.get_full_name() if club.admin_owner_id else "Add the Club Owner from the club's page")},
        {"key": "login", "label": "Owner has logged in", "done": logged_in, "hint": "They set their own password at first login"},
        {"key": "coach", "label": "Add wellness coaches", "done": club.coaches.filter(is_active=True).exists(), "hint": "At least one coach is needed to issue coupons"},
        {"key": "stock", "label": "Get a coupon range", "done": Allocation.objects.filter(club=club).exists(), "hint": "The Super Admin allocates numbers from a print batch"},
        {"key": "issue", "label": "Issue the first coupon", "done": CouponIssue.objects.filter(club=club).exists(), "hint": "Use the coupon desk on the home screen"},
    ]
    return steps


@api_view(["GET"])
@permission_classes([NotSupervisor])
def dash(request):
    club = read_club(request)
    key = request.query_params.get("range", "d30")
    start, end, prev = _period(key)
    club_q = {"club": club} if club else {}
    now = _metrics(club_q, start, end)
    before = _metrics(club_q, *prev) if prev else None
    out = {
        "range": key, "start": d(start), "end": d(end), "scope": club.name if club else "All clubs",
        "kpis": now,
        "deltas": {k: _delta(now[k], before[k]) for k in ("visits", "d2", "trials", "cvc")} if before else None,
        "spark": _spark(club_q, start, end),
        "funnel": [["Coupons issued", now["issued"]], ["Friends visited", now["visits"]], ["Day 1 redeemed", now["d1"]],
                   ["Day 2 redeemed", now["d2"]], ["Trials started", now["trials"]], ["Trials completed", now["trials_done"]],
                   ["Joined CVC", now["cvc"]]],
        "top_inviters": _top_inviters(club_q, start, end, admin=not club),
    }
    if club:
        steps = _setup(club)
        out.update({"club": {"id": club.id, "name": club.name, "city": club.city, "is_active": club.is_active},
                    "stock": _stock_info(club), "coaches": _coach_rank(club, start, end), "today": _today(club),
                    "setup": steps, "setup_done": all(s["done"] for s in steps)})
        ranges = defaultdict(list)
        for code, num in CouponUnit.objects.filter(club=club, status="ALLOCATED").values_list("batch__code", "number").order_by("batch__code", "number"):
            ranges[code].append(num)
        out["stock"]["batches"] = [{"batch": b, "count": len(n), "first": n[0], "last": n[-1]} for b, n in ranges.items()]
        out["stock"]["valid_days"] = sorted(set(PrintBatch.objects.filter(units__club=club, units__status="ALLOCATED").values_list("valid_days", flat=True).distinct()))
        return Response(out)
    if not request.user.is_admin:
        raise Rule("Choose a club first.")
    out.update(_admin_extras(start, end))
    return Response(out)


def _count_by_club(qs, field="created_at", start=None, end=None):
    return dict(_between(qs, field, start, end).values_list("club").annotate(n=Count("id")).values_list("club", "n"))


def _admin_extras(start, end):
    today = timezone.localdate()
    clubs = list(Club.objects.select_related("admin_owner").prefetch_related("staff"))
    issued = _count_by_club(CouponIssue.objects.all(), start=start, end=end)
    visits = _count_by_club(ReferralVisit.objects.all(), start=start, end=end)
    d2 = _count_by_club(Redemption.objects.filter(day=2, is_void=False), start=start, end=end)
    trials = _count_by_club(Trial.objects.all(), start=start, end=end)
    cvc = _count_by_club(CvcMembership.objects.all(), start=start, end=end)
    stock = dict(CouponUnit.objects.filter(status="ALLOCATED", club__isnull=False).values_list("club").annotate(n=Count("id")).values_list("club", "n"))
    last_issue = dict(CouponIssue.objects.values_list("club").annotate(m=Count("id")).values_list("club", "m"))
    recent = set(CouponIssue.objects.filter(created_at__date__gte=today - timedelta(days=6)).values_list("club", flat=True)) | \
        set(ReferralVisit.objects.filter(created_at__date__gte=today - timedelta(days=6)).values_list("club", flat=True))
    issued30 = _count_by_club(CouponIssue.objects.all(), start=today - timedelta(days=29))
    allocated = set(Allocation.objects.values_list("club", flat=True))
    rows, attention = [], []
    week_ago = timezone.now() - timedelta(days=7)
    logged_week = 0
    for c in clubs:
        owner = next((u for u in c.staff.all() if u.role == "OWNER" and u.is_active), None)
        owner_name = (owner.get_full_name() or owner.username) if owner else ((c.admin_owner.get_full_name() or c.admin_owner.username) if c.admin_owner_id else None)
        t, v = trials.get(c.id, 0), cvc.get(c.id, 0)
        row = {"id": c.id, "name": c.name, "city": c.city, "is_active": c.is_active, "owner": owner_name, "mine": bool(c.admin_owner_id),
               "issued": issued.get(c.id, 0), "visits": visits.get(c.id, 0), "d2": d2.get(c.id, 0), "trials": t, "cvc": v,
               "conversion": round(v / t * 100) if t else None, "stock": stock.get(c.id, 0)}
        rows.append(row)
        if not c.is_active:
            continue
        seen = bool(c.admin_owner_id) or bool(owner and owner.last_login and owner.last_login >= week_ago)
        logged_week += 1 if seen else 0
        per_day = issued30.get(c.id, 0) / 30
        if c.id in allocated and stock.get(c.id, 0) < 20:
            days = round(stock.get(c.id, 0) / per_day) if per_day else None
            left = stock.get(c.id, 0)
            attention.append({"kind": "stock", "level": "bad" if not left else "warn", "club": c.id,
                              "title": f"{c.name}: out of coupons" if not left else f"{c.name}: {left} coupons left",
                              "text": ("Nothing left to issue. " if not left else f"About {days} days at this pace. " if days else "") + "Allocate more."})
        if not last_issue.get(c.id) and (not owner or not owner.last_login) and not c.admin_owner_id:
            attention.append({"kind": "start", "level": "warn", "club": c.id, "title": f"{c.name} not started",
                              "text": "Owner hasn't logged in yet" if owner else "No Club Owner login yet"})
        elif last_issue.get(c.id) and c.id not in recent:
            attention.append({"kind": "quiet", "level": "info", "club": c.id, "title": f"{c.name} quiet for 7+ days", "text": "No coupons issued or visits recorded this week"})
    not_started = [x for x in attention if x["kind"] == "start"]
    if len(not_started) > 2:
        attention = [x for x in attention if x["kind"] != "start"]
        attention.append({"kind": "start_many", "level": "warn", "title": f"{len(not_started)} clubs not started",
                          "text": "Owners haven't logged in yet: " + ", ".join(x["title"].replace(" not started", "") for x in not_started[:3]) + ("…" if len(not_started) > 3 else "")})
    resets = PasswordResetRequest.objects.filter(status="PENDING").count()
    if resets:
        attention.insert(0, {"kind": "resets", "level": "bad", "title": f"{resets} password reset{'s' if resets > 1 else ''}",
                             "text": "Club Owners waiting for a temporary password"})
    units = dict(CouponUnit.objects.values_list("status").annotate(n=Count("id")).values_list("status", "n"))
    rows.sort(key=lambda r: (not r["is_active"], -(r["conversion"] or -1), -r["visits"]))
    active = [c for c in clubs if c.is_active]
    return {"clubs": rows, "attention": attention[:8],
            "inventory": {"printed": sum(units.values()), "with_clubs": units.get("ALLOCATED", 0), "issued": units.get("ISSUED", 0),
                          "free": units.get("FREE", 0), "batches": PrintBatch.objects.count()},
            "logins": {"seen": logged_week, "total": len(active)}}
