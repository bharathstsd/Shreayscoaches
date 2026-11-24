"""Club scoping, edit permissions, audit logging and JSON shapes shared by the API views."""
import re

from django.utils import timezone

from .errors import Forbidden, Rule
from .models import AuditLog, Club, Coach, Customer

MOBILE_RE = re.compile(r"^[6-9]\d{9}$")


def clean_mobile(value, required=True):
    m = re.sub(r"\D", "", str(value or ""))
    if len(m) == 12 and m.startswith("91"):
        m = m[2:]
    if not m and not required:
        return ""
    if not MOBILE_RE.match(m):
        raise Rule("Enter a 10-digit mobile number starting with 6, 7, 8 or 9.")
    return m


def text(data, key, required=True, label=None, max_len=255):
    v = str(data.get(key) or "").strip()
    if required and not v:
        raise Rule(f"{label or key.replace('_', ' ').capitalize()} is required.")
    return v[:max_len]


def parse_date(value, label, required=True, not_future=False, min_date=None):
    """Turn "2026-11-24" into a date, with a clear message instead of a server error."""
    from datetime import date
    v = str(value or "").strip()
    if not v:
        if required:
            raise Rule(f"Choose the {label}.")
        return None
    try:
        dt = date.fromisoformat(v[:10])
    except ValueError:
        raise Rule(f"The {label} isn't a valid date.")
    if not_future and dt > timezone.localdate():
        raise Rule(f"The {label} can't be in the future.")
    if min_date and dt < min_date:
        raise Rule(f"The {label} is too far in the past.")
    return dt


def number(value, label, lo, hi):
    if value in (None, ""):
        return None
    try:
        n = round(float(value), 1)
    except (TypeError, ValueError):
        raise Rule(f"{label} must be a number.")
    if not lo <= n <= hi:
        raise Rule(f"{label} should be between {lo:g} and {hi:g}.")
    return n


# ---------- scope ----------
def read_club(request):
    """Club to read from. Staff: always their own. Admin: ?club=<id> or None (all clubs)."""
    u = request.user
    if not u.is_admin:
        return u.club
    cid = request.query_params.get("club")
    return Club.objects.filter(pk=cid).first() if cid else None


def write_club(request, data=None):
    """Club a new record belongs to. Admin must say which club; staff get their own. Disabled clubs are read-only."""
    u = request.user
    if u.is_admin:
        cid = (data or {}).get("club") or request.query_params.get("club")
        club = Club.objects.filter(pk=cid).first() if cid else None
        if not club:
            raise Rule("Choose a club first.")
    else:
        club = u.club
    if not club.is_active:
        raise Forbidden(f"{club.name} is disabled. Enable the club before entering data.")
    return club


def scoped(qs, request, field="club"):
    club = read_club(request)
    return qs.filter(**{field: club}) if club else qs


def get_scoped(model, request, pk, field="club"):
    obj = model.objects.filter(pk=pk).first()
    if not obj:
        raise Rule("That record doesn't exist.")
    club = _club_of(obj, field)
    if not request.user.is_admin and club != request.user.club:
        raise Rule("That record doesn't exist.")       # never reveal other clubs' records
    return obj


def _club_of(obj, field="club"):
    cur = obj
    for part in field.split("__"):
        cur = getattr(cur, part)
    return cur


def can_change(user, obj):
    """Super Admin: anything. Club Owner: anything in their club. Supervisor: only what they entered."""
    if user.is_admin:
        return True
    if getattr(obj, "club_id", None) != user.club_id:
        return False
    if user.role == "OWNER":
        return True
    return getattr(obj, "created_by_id", None) == user.id


def require_change(user, obj):
    if not can_change(user, obj):
        raise Forbidden("You can only change records you entered yourself.")
    club = getattr(obj, "club", None)
    if club is not None and not club.is_active:
        raise Forbidden(f"{club.name} is disabled. Enable the club before changing data.")


def upline(data, required=True):
    """Sponsor / upline details: name, mobile and Herbalife ID (all required)."""
    name = text(data, "upline_name", required, label="Upline / sponsor name", max_len=120)
    mob = clean_mobile(data.get("upline_mobile"), required=required)
    hid = text(data, "upline_herbalife_id", required, label="Upline / sponsor Herbalife ID", max_len=40)
    return {"upline_name": name, "upline_mobile": mob, "upline_herbalife_id": hid}


def coach_for(club, coach_id, required=True):
    if not coach_id:
        if required:
            raise Rule("Choose the responsible wellness coach.")
        return None
    c = Coach.objects.filter(pk=coach_id, club=club, is_active=True).first()
    if not c:
        raise Rule("Choose an active coach from this club's coach list.")
    return c


def customer_for(club, cid):
    c = Customer.objects.filter(pk=cid, club=club, is_deleted=False).first()
    if not c:
        raise Rule("Choose a customer from this club.")
    return c


# ---------- audit ----------
def audit(request, action, entity, obj=None, before=None, after=None, club=None):
    ip = (request.META.get("HTTP_X_FORWARDED_FOR") or request.META.get("REMOTE_ADDR") or "").split(",")[0].strip() or None
    AuditLog.objects.create(
        actor=request.user if request.user.is_authenticated else None,
        club=club or getattr(obj, "club", None) if not isinstance(obj, Club) else obj,
        action=action, entity=entity, entity_id=str(getattr(obj, "pk", "") or ""),
        before=before, after=after, ip=ip)


def snapshot(obj, fields):
    out = {}
    for f in fields:
        v = getattr(obj, f, None)
        out[f] = v.isoformat() if hasattr(v, "isoformat") else (v.pk if hasattr(v, "pk") else v)
    return out


# ---------- JSON shapes ----------
def d(v):
    return v.isoformat() if v else None


def club_json(c, stats=None):
    out = {"id": c.id, "name": c.name, "city": c.city, "state": c.state, "address": c.address, "pincode": c.pincode,
           "owner_name": c.owner_name, "owner_mobile": c.owner_mobile, "is_active": c.is_active,
           "admin_owner": c.admin_owner_id, "admin_owner_name": (c.admin_owner.get_full_name() or c.admin_owner.username) if c.admin_owner_id else None}
    if stats is not None:
        out.update(stats)
    return out


def user_json(u):
    return {"id": u.id, "username": u.username, "name": u.get_full_name() or u.username, "first_name": u.first_name,
            "last_name": u.last_name, "role": u.role, "mobile": u.mobile, "herbalife_id": u.herbalife_id,
            "club": u.club_id, "club_name": u.club.name if u.club else None, "is_active": u.is_active,
            "upline_name": u.upline_name, "upline_mobile": u.upline_mobile, "upline_herbalife_id": u.upline_herbalife_id,
            "must_change_password": u.must_change_password,
            "owned_clubs": [{"id": c.id, "name": c.name, "city": c.city} for c in u.admin_clubs.filter(is_active=True)] if u.role == "ADMIN" else []}


def coach_json(c):
    return {"id": c.id, "name": c.name, "mobile": c.mobile, "herbalife_id": c.herbalife_id, "is_active": c.is_active, "club": c.club_id,
            "upline_name": c.upline_name, "upline_mobile": c.upline_mobile, "upline_herbalife_id": c.upline_herbalife_id}


def eligibility(c):
    """What a customer can get a coupon for, in SRS order: trial → CVC → weekly award."""
    trial = getattr(c, "trial", None) if hasattr(c, "trial") else None
    cvc = getattr(c, "cvc", None) if hasattr(c, "cvc") else None
    trial_coupon = bool(trial and hasattr(trial, "coupon"))
    cvc_coupon = bool(cvc and hasattr(cvc, "coupon"))
    award = c.weekly_results.filter(award_approved=True, coupon__isnull=True).first()

    if cvc:
        t = ("Promoted to CVC", True)
    elif trial_coupon:
        t = ("Trial coupon already given", True)
    else:
        t = ("Available", False)
    if not trial or not trial.is_completed:
        v = ("Requires completed trial", True)
    elif not cvc:
        v = ("Convert to CVC first", True)
    elif cvc_coupon:
        v = ("CVC coupon already given", True)
    else:
        v = ("Available", False)
    if not cvc:
        w = ("Requires CVC first", True)
    elif award:
        w = ("Award approved", False)
    else:
        w = ("Needs approved award", True)
    return [
        {"key": "TRIAL", "label": "3 Days Trial", "hint": "Once per person, across all clubs", "state": t[0], "locked": t[1]},
        {"key": "CVC", "label": "CVC Membership", "hint": "After the trial is completed", "state": v[0], "locked": v[1]},
        {"key": "WEEKLY", "label": "Weekly Results", "hint": "Best Results award, CVC members only", "state": w[0], "locked": w[1]},
    ]


def stage(c):
    cvc = hasattr(c, "cvc")
    trial = c.trial if hasattr(c, "trial") else None
    if cvc:
        return "CVC member"
    if trial and trial.is_completed:
        return "Trial done"
    if trial:
        return "In trial"
    vis = getattr(c, "is_visitor", None)
    if vis is None:
        vis = c.visits.exists()
    return "Visitor" if vis else "New"


def customer_json(c, full=False):
    out = {"id": c.id, "name": c.name, "mobile": c.mobile, "gender": c.gender, "dob": d(c.dob), "notes": c.notes,
           "club": c.club_id, "coach": c.coach_id, "coach_name": c.coach.name if c.coach else None, "stage": stage(c),
           "created_by": c.created_by_id}
    if full:
        trial = c.trial if hasattr(c, "trial") else None
        out["trial"] = trial_json(trial) if trial else None
        out["cvc"] = {"id": c.cvc.id, "start_date": d(c.cvc.start_date)} if hasattr(c, "cvc") else None
        out["purposes"] = eligibility(c)
        out["coupons"] = [issue_json(i) for i in c.issues.select_related("unit__batch", "coach").all()]
    return out


def trial_json(t):
    return {"id": t.id, "customer": t.customer_id, "customer_name": t.customer.name, "start_date": d(t.start_date),
            "days": [t.day1, t.day2, t.day3], "status": t.status, "has_coupon": hasattr(t, "coupon"),
            "created_by": t.created_by_id, "club": t.club_id}


def issue_status(i, v=None):
    if v is None:
        v = i.visit if hasattr(i, "visit") else None
    if v:
        days = {r.day for r in v.redemptions.all() if not r.is_void}
        if 2 in days:
            return "Day 2 done"
        if 1 in days:
            return "Expired" if i.is_expired else "Day 1 done"
        return "Expired" if i.is_expired else "Friend registered"
    if i.is_paused:
        return "Paused"
    return "Expired" if i.is_expired else "Waiting"


def issue_json(i):
    v = getattr(i, "visit", None) if hasattr(i, "visit") else None
    return {"id": i.id, "coupon": i.unit.label(), "batch": i.unit.batch.code, "number": i.unit.number,
            "customer": i.customer_id, "customer_name": i.customer.name, "customer_mobile": i.customer.mobile, "purpose": i.purpose,
            "purpose_label": i.get_purpose_display(), "coach_name": i.coach.name, "issued_at": d(i.created_at),
            "is_paused": i.is_paused, "visitor_name": v.visitor.name if v else None, "club": i.club_id,
            "created_by": i.created_by_id, "expires_on": d(i.expires_on), "status": issue_status(i, v)}


def visit_json(v):
    reds = [r for r in v.redemptions.all() if not r.is_void]
    days = {r.day for r in reds}
    return {"id": v.id, "visitor": v.visitor_id, "visitor_name": v.visitor.name, "visitor_mobile": v.visitor.mobile,
            "coupon": v.issue.unit.label(), "inviter_name": v.inviter_name, "coach_name": v.coach.name,
            "day1": 1 in days, "day2": 2 in days, "club": v.club_id, "visited_at": d(v.created_at),
            "redemptions": [{"id": r.id, "day": r.day, "at": d(r.created_at), "created_by": r.created_by_id} for r in reds]}


def now():
    return timezone.now()
