"""REST API. Every rule is checked here on the server; the app's locked buttons are only a convenience."""
import csv
import io
import secrets
import string
from collections import defaultdict, deque
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, password_validation
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .auth import AdminOnly, NotSupervisor
from .errors import Forbidden, Rule
from .helpers import (audit, can_change, clean_mobile, club_json, coach_for, coach_json, customer_for, customer_json, d,
                      get_scoped, issue_json, read_club, require_change, scoped, snapshot, text, trial_json, user_json,
                      visit_json, write_club)
from .models import (Allocation, AuditLog, Club, Coach, CouponIssue, CouponUnit, Customer, CvcMembership,
                     PasswordResetRequest, PrintBatch, Redemption, ReferralVisit, Trial, User, WeeklyResult)


def _throttle(scope):
    class T(ScopedRateThrottle):
        def get_rate(self):
            self.scope = scope
            return settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"][scope]

        def allow_request(self, request, view):
            self.scope = scope
            self.rate = self.get_rate()
            self.num_requests, self.duration = self.parse_rate(self.rate)
            return super(ScopedRateThrottle, self).allow_request(request, view)
    return T


def temp_password():
    alphabet = string.ascii_letters + string.digits
    while True:
        p = "".join(secrets.choice(alphabet) for _ in range(10))
        if any(c.isdigit() for c in p) and any(c.isupper() for c in p) and any(c.islower() for c in p):
            return p


# =====================================================================  AUTH
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([_throttle("login")])
def login(request):
    ident = text(request.data, "username", label="Username or mobile")
    password = request.data.get("password") or ""
    user = User.objects.filter(Q(username__iexact=ident) | Q(mobile=ident)).first()
    if not user or not user.is_active or not authenticate(request, username=user.username, password=password):
        raise Rule("Wrong username or password.")
    if not user.is_admin and user.club and not user.club.is_active:
        raise Forbidden("Your club is disabled. Please contact the Super Admin.")
    if user.must_change_password and user.temp_password_expires and user.temp_password_expires < timezone.now():
        PasswordResetRequest.objects.filter(user=user, status="GENERATED").update(status="EXPIRED")
        raise Rule("Your temporary password has expired. Ask the Super Admin for a new one.")
    Token.objects.filter(user=user).delete()
    token = Token.objects.create(user=user)
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    return Response({"token": token.key, "user": user_json(user)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(user_json(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    u = request.user
    cur, new, again = request.data.get("current") or "", request.data.get("new") or "", request.data.get("confirm") or ""
    if not u.check_password(cur):
        raise Rule("Your current password is wrong.")
    if new != again:
        raise Rule("The two new passwords don't match.")
    if new == cur:
        raise Rule("Choose a password different from the current one.")
    try:
        password_validation.validate_password(new, u)
    except ValidationError as e:
        raise Rule(" ".join(e.messages))
    u.set_password(new)
    u.must_change_password = False
    u.temp_password_expires = None
    u.save()
    PasswordResetRequest.objects.filter(user=u, status="GENERATED").update(status="COMPLETED", handled_at=timezone.now())
    audit(request, "password_change", "user", u, club=u.club)
    return Response({"ok": True, "user": user_json(u)})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([_throttle("reset")])
def forgot_password(request):
    ident = text(request.data, "username", label="Username or mobile")
    user = User.objects.filter(Q(username__iexact=ident) | Q(mobile=ident), is_active=True).exclude(role="ADMIN").first()
    if user and not PasswordResetRequest.objects.filter(user=user, status="PENDING").exists():
        PasswordResetRequest.objects.create(user=user, identifier=ident[:150], reason=str(request.data.get("reason") or "")[:255])
    # same answer either way, so nobody can test which accounts exist
    return Response({"ok": True, "message": "If that account exists, the Super Admin will share a temporary password with you."})


@api_view(["GET"])
@permission_classes([AdminOnly])
def reset_list(request):
    qs = PasswordResetRequest.objects.select_related("user__club").filter(user__isnull=False)[:100]
    return Response([{"id": r.id, "name": r.user.get_full_name() or r.user.username, "username": r.user.username,
                      "role": r.user.get_role_display(), "club": r.user.club.name if r.user.club else "",
                      "reason": r.reason, "status": r.status, "created_at": d(r.created_at)} for r in qs])


@api_view(["POST"])
@permission_classes([AdminOnly])
def reset_generate(request, pk):
    r = PasswordResetRequest.objects.select_related("user").filter(pk=pk).first()
    if not r or not r.user:
        raise Rule("That request doesn't exist.")
    if r.status not in ("PENDING", "GENERATED", "EXPIRED"):
        raise Rule("This request is already closed.")
    pw = temp_password()
    u = r.user
    u.set_password(pw)
    u.must_change_password = True
    u.temp_password_expires = timezone.now() + timedelta(hours=settings.TEMP_PASSWORD_TTL_HOURS)
    u.save()
    Token.objects.filter(user=u).delete()
    r.status, r.handled_by, r.handled_at = "GENERATED", request.user, timezone.now()
    r.save()
    audit(request, "temp_password_generated", "user", u, club=u.club)   # never the password itself
    expires = timezone.localtime(u.temp_password_expires).strftime("%d %b %Y, %I:%M %p")
    name = u.get_full_name() or u.username
    msg = (f"Hello {name},\nYour temporary login password for Shreyas Wellness World Coupon Management System is:\n"
           f"Username: {u.username}\nTemporary Password: {pw}\nPlease log in and change your password immediately. "
           f"This password expires at {expires}.")
    return Response({"password": pw, "message": msg, "expires": d(u.temp_password_expires)})


@api_view(["POST"])
@permission_classes([AdminOnly])
def reset_reject(request, pk):
    r = PasswordResetRequest.objects.filter(pk=pk, status="PENDING").first()
    if not r:
        raise Rule("That request isn't pending.")
    r.status, r.handled_by, r.handled_at = "REJECTED", request.user, timezone.now()
    r.reject_reason = str(request.data.get("reason") or "")[:255]
    r.save()
    audit(request, "reset_rejected", "reset_request", r)
    return Response({"ok": True})


# =====================================================================  CLUBS & STAFF
def _club_stats(club):
    valid = Redemption.objects.filter(club=club, is_void=False)
    return {"issued": CouponIssue.objects.filter(club=club).count(),
            "d1": valid.filter(day=1).count(), "d2": valid.filter(day=2).count(),
            "trials": Trial.objects.filter(club=club).count(),
            "cvc": CvcMembership.objects.filter(club=club).count(),
            "stock": CouponUnit.objects.filter(club=club, status="ALLOCATED").count(),
            "coaches": Coach.objects.filter(club=club, is_active=True).count(),
            "owner": next((u.get_full_name() or u.username for u in club.staff.all() if u.role == "OWNER" and u.is_active), None),
            "supervisor": next((u.get_full_name() or u.username for u in club.staff.all() if u.role == "SUPERVISOR" and u.is_active), None)}


@api_view(["GET", "POST"])
def clubs(request):
    if request.method == "GET":
        qs = Club.objects.prefetch_related("staff").all()
        if not request.user.is_admin:
            qs = qs.filter(pk=request.user.club_id)
        return Response([club_json(c, _club_stats(c)) for c in qs])
    if not request.user.is_admin:
        raise Forbidden("Only the Super Admin can create clubs.")
    name = text(request.data, "name", label="Club name", max_len=120)
    if Club.objects.filter(name__iexact=name).exists():
        raise Rule("A club with this name already exists.")
    c = Club.objects.create(name=name, city=text(request.data, "city", False), state=text(request.data, "state", False) or "Andhra Pradesh",
                            address=text(request.data, "address", False), pincode=text(request.data, "pincode", False, max_len=10),
                            owner_name=text(request.data, "owner_name", False), owner_mobile=clean_mobile(request.data.get("owner_mobile"), required=False))
    audit(request, "create", "club", c, after=club_json(c))
    return Response(club_json(c, _club_stats(c)), status=201)


@api_view(["GET", "PATCH"])
def club_detail(request, pk):
    c = Club.objects.filter(pk=pk).first()
    if not c or (not request.user.is_admin and c.id != request.user.club_id):
        raise Rule("That club doesn't exist.")
    if request.method == "PATCH":
        if not request.user.is_admin:
            raise Forbidden("Only the Super Admin can edit club details.")
        before = club_json(c)
        for f in ("name", "city", "state", "address", "pincode", "owner_name"):
            if f in request.data:
                setattr(c, f, text(request.data, f, f == "name"))
        if "owner_mobile" in request.data:
            c.owner_mobile = clean_mobile(request.data.get("owner_mobile"), required=False)
        if Club.objects.filter(name__iexact=c.name).exclude(pk=c.pk).exists():
            raise Rule("A club with this name already exists.")
        c.save()
        audit(request, "edit", "club", c, before=before, after=club_json(c))
    allocs = [{"batch": a.batch.code, "start": a.start_number, "end": a.end_number} for a in c.allocations.select_related("batch")]
    staff = [user_json(u) for u in c.staff.all()]
    return Response({**club_json(c, _club_stats(c)), "allocations": allocs, "staff": staff})


@api_view(["POST"])
@permission_classes([AdminOnly])
def club_toggle(request, pk):
    c = Club.objects.filter(pk=pk).first()
    if not c:
        raise Rule("That club doesn't exist.")
    c.is_active = not c.is_active
    c.save(update_fields=["is_active"])
    if not c.is_active:
        Token.objects.filter(user__club=c).delete()     # log out its staff now
    audit(request, "enable" if c.is_active else "disable", "club", c)
    return Response(club_json(c, _club_stats(c)))


@api_view(["GET", "POST"])
@permission_classes([AdminOnly])
def users(request):
    if request.method == "GET":
        return Response([user_json(u) for u in User.objects.select_related("club").order_by("club__name", "role")])
    data = request.data
    role = data.get("role")
    if role not in ("OWNER", "SUPERVISOR"):
        raise Rule("Choose Club Owner or Supervisor.")
    club = Club.objects.filter(pk=data.get("club")).first()
    if not club:
        raise Rule("Choose a club.")
    if not club.is_active:
        raise Forbidden(f"{club.name} is disabled. Enable the club before adding staff.")
    username = text(data, "username", max_len=150).lower()
    mobile = clean_mobile(data.get("mobile"))
    hid = text(data, "herbalife_id", label="Herbalife / Staff ID", max_len=40)
    if User.objects.filter(username__iexact=username).exists():
        raise Rule("That username is already taken.")
    if User.objects.filter(mobile=mobile).exists():
        raise Rule("That mobile number is already used by another account.")
    if User.objects.filter(club=club, role=role, is_active=True).exists():
        raise Rule(f"{club.name} already has an active {'Club Owner' if role == 'OWNER' else 'Supervisor'}. Edit or deactivate that account instead.")
    pw = temp_password()
    u = User(username=username, first_name=text(data, "first_name", label="Name", max_len=150), last_name=text(data, "last_name", False, max_len=150),
             role=role, club=club, mobile=mobile, herbalife_id=hid, must_change_password=True,
             temp_password_expires=timezone.now() + timedelta(hours=settings.TEMP_PASSWORD_TTL_HOURS))
    u.set_password(pw)
    u.save()
    audit(request, "create", "user", u, after=user_json(u), club=club)
    return Response({"user": user_json(u), "password": pw}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([AdminOnly])
def user_detail(request, pk):
    u = User.objects.filter(pk=pk).exclude(role="ADMIN").first()
    if not u:
        raise Rule("That account doesn't exist.")
    if request.method == "DELETE":
        used = (Customer.objects.filter(created_by=u).exists() or CouponIssue.objects.filter(created_by=u).exists()
                or Redemption.objects.filter(created_by=u).exists() or ReferralVisit.objects.filter(created_by=u).exists())
        if used:
            u.is_active = False
            u.save(update_fields=["is_active"])
            Token.objects.filter(user=u).delete()
            audit(request, "deactivate", "user", u, club=u.club)
            return Response({"ok": True, "deactivated": True, "message": "This account has entries, so it was deactivated instead of deleted."})
        audit(request, "delete", "user", u, before=user_json(u), club=u.club)
        u.delete()
        return Response({"ok": True, "deleted": True})
    before = user_json(u)
    data = request.data
    for f in ("first_name", "last_name"):
        if f in data:
            setattr(u, f, text(data, f, f == "first_name", max_len=150))
    if "herbalife_id" in data:
        u.herbalife_id = text(data, "herbalife_id", label="Herbalife / Staff ID", max_len=40)
    if "mobile" in data:
        m = clean_mobile(data.get("mobile"))
        if User.objects.filter(mobile=m).exclude(pk=u.pk).exists():
            raise Rule("That mobile number is already used by another account.")
        u.mobile = m
    if "is_active" in data:
        u.is_active = bool(data.get("is_active"))
    if "club" in data or "role" in data:
        club = Club.objects.filter(pk=data.get("club", u.club_id)).first()
        role = data.get("role", u.role)
        if not club or role not in ("OWNER", "SUPERVISOR"):
            raise Rule("Choose a club and a role.")
        u.club, u.role = club, role
    if u.is_active and User.objects.filter(club=u.club, role=u.role, is_active=True).exclude(pk=u.pk).exists():
        raise Rule(f"{u.club.name} already has an active {u.get_role_display()}.")
    u.save()
    if not u.is_active:
        Token.objects.filter(user=u).delete()
    audit(request, "edit", "user", u, before=before, after=user_json(u), club=u.club)
    return Response(user_json(u))


# =====================================================================  COACHES
@api_view(["GET", "POST"])
def coaches(request):
    if request.method == "GET":
        return Response([coach_json(c) for c in scoped(Coach.objects.all(), request)])
    if request.user.role == "SUPERVISOR":
        raise Forbidden("Only the Club Owner or Super Admin can add coaches.")
    club = write_club(request, request.data)
    c = Coach.objects.create(club=club, name=text(request.data, "name", label="Coach name", max_len=120),
                             mobile=clean_mobile(request.data.get("mobile")),
                             herbalife_id=text(request.data, "herbalife_id", False, max_len=40),
                             created_by=request.user)
    audit(request, "create", "coach", c, after=coach_json(c))
    return Response(coach_json(c), status=201)


@api_view(["PATCH"])
def coach_detail(request, pk):
    if request.user.role == "SUPERVISOR":
        raise Forbidden("Only the Club Owner or Super Admin can edit coaches.")
    c = get_scoped(Coach, request, pk)
    require_change(request.user, c)
    before = coach_json(c)
    if "name" in request.data:
        c.name = text(request.data, "name", label="Coach name", max_len=120)
    if "mobile" in request.data:
        c.mobile = clean_mobile(request.data.get("mobile"))
    if "herbalife_id" in request.data:
        c.herbalife_id = text(request.data, "herbalife_id", False, max_len=40)
    if "is_active" in request.data:
        c.is_active = bool(request.data.get("is_active"))
    c.updated_by = request.user
    c.save()
    audit(request, "edit", "coach", c, before=before, after=coach_json(c))
    return Response(coach_json(c))


# =====================================================================  BATCHES & ALLOCATION
COLORS = ["#B48A2C", "#2F7D6D", "#6B5CA5", "#B5543A", "#2D6A9F", "#7A7F2A"]


def _batch_json(b):
    counts = dict(b.units.values_list("status").annotate(n=Count("id")).values_list("status", "n"))
    return {"id": b.id, "code": b.code, "name": b.name, "start": b.start_number, "end": b.end_number, "quantity": b.quantity,
            "print_date": d(b.print_date), "color": b.color, "allocated": counts.get("ALLOCATED", 0) + counts.get("ISSUED", 0),
            "issued": counts.get("ISSUED", 0), "free": counts.get("FREE", 0), "deletable": counts.get("ISSUED", 0) == 0}


@api_view(["GET", "POST"])
@permission_classes([AdminOnly])
def batches(request):
    if request.method == "GET":
        return Response([_batch_json(b) for b in PrintBatch.objects.all()])
    try:
        start, end = int(request.data.get("start")), int(request.data.get("end"))
    except (TypeError, ValueError):
        raise Rule("Enter the first and last printed numbers.")
    if start < 1 or end < start:
        raise Rule("The last number must be bigger than the first.")
    if end - start + 1 > 20000:
        raise Rule("One batch can have at most 20,000 coupons.")
    with transaction.atomic():
        last = PrintBatch.objects.select_for_update().aggregate(m=Max("id"))["m"] or 0
        n = last + 1
        while PrintBatch.objects.filter(code=f"PB-{n:04d}").exists():
            n += 1
        b = PrintBatch.objects.create(code=f"PB-{n:04d}", name=text(request.data, "name", False, max_len=80), start_number=start,
                                      end_number=end, print_date=request.data.get("print_date") or None,
                                      color=COLORS[(n - 1) % len(COLORS)], created_by=request.user)
        CouponUnit.objects.bulk_create([CouponUnit(batch=b, number=i) for i in range(start, end + 1)], batch_size=2000)
    audit(request, "create", "print_batch", b, after={"code": b.code, "start": start, "end": end})
    return Response(_batch_json(b), status=201)


@api_view(["DELETE"])
@permission_classes([AdminOnly])
def batch_detail(request, pk):
    with transaction.atomic():
        b = PrintBatch.objects.select_for_update().filter(pk=pk).first()
        if not b:
            raise Rule("That batch doesn't exist.")
        issued = b.units.filter(status="ISSUED").count()
        if issued:
            raise Rule(f"{b.code} is in use ({issued} issued) and can't be deleted.")
        code = b.code
        b.units.all().delete()
        b.allocations.all().delete()
        b.delete()
    audit(request, "permanent_delete", "print_batch", None, after={"code": code})
    return Response({"ok": True})


@api_view(["GET", "POST"])
def allocations(request):
    if request.method == "GET":
        qs = scoped(Allocation.objects.select_related("batch", "club"), request)
        return Response([{"id": a.id, "batch": a.batch.code, "club": a.club.name, "club_id": a.club_id, "start": a.start_number,
                          "end": a.end_number, "quantity": a.end_number - a.start_number + 1, "date": d(a.created_at)} for a in qs])
    if not request.user.is_admin:
        raise Forbidden("Only the Super Admin can allocate coupons.")
    b = PrintBatch.objects.filter(pk=request.data.get("batch")).first()
    club = Club.objects.filter(pk=request.data.get("club")).first()
    if not b or not club:
        raise Rule("Choose a batch and a club.")
    if not club.is_active:
        raise Rule("Disabled clubs can't receive coupons.")
    try:
        s, e = int(request.data.get("start")), int(request.data.get("end"))
    except (TypeError, ValueError):
        raise Rule("Enter both coupon numbers.")
    if s > e:
        raise Rule("\"From\" must be smaller than \"To\".")
    if s < b.start_number or e > b.end_number:
        raise Rule(f"{b.code} only has numbers #{b.start_number} – #{b.end_number}.")
    with transaction.atomic():
        units = list(CouponUnit.objects.select_for_update().filter(batch=b, number__gte=s, number__lte=e))
        taken = [u for u in units if u.status != "FREE"]
        if taken:
            owner = taken[0].club.name if taken[0].club else "another club"
            raise Rule(f"Some of these numbers (from #{taken[0].number}) already belong to {owner}. A coupon can belong to only one club.")
        a = Allocation.objects.create(batch=b, club=club, start_number=s, end_number=e, created_by=request.user,
                                      remarks=text(request.data, "remarks", False))
        CouponUnit.objects.filter(pk__in=[u.pk for u in units]).update(status="ALLOCATED", allocation=a, club=club)
    audit(request, "allocate", "allocation", a, after={"batch": b.code, "start": s, "end": e}, club=club)
    return Response({"id": a.id, "quantity": e - s + 1}, status=201)


def _ranges(nums):
    out, s, p = [], None, None
    for n in sorted(nums):
        if s is None:
            s = p = n
        elif n == p + 1:
            p = n
        else:
            out.append([s, p])
            s = p = n
    if s is not None:
        out.append([s, p])
    return out


@api_view(["GET"])
def stock(request):
    """Unissued coupons this club holds, grouped by batch into ranges like #20–#50."""
    club = read_club(request)
    if not club:
        raise Rule("Choose a club first.")
    by_batch = defaultdict(list)
    for code, color, num in CouponUnit.objects.filter(club=club, status="ALLOCATED").values_list("batch__code", "batch__color", "number"):
        by_batch[(code, color)].append(num)
    return Response([{"batch": code, "color": color, "count": len(nums), "ranges": _ranges(nums)} for (code, color), nums in sorted(by_batch.items())])


@api_view(["GET"])
def stock_find(request):
    club = read_club(request)
    try:
        n = int(request.query_params.get("number"))
    except (TypeError, ValueError):
        raise Rule("Enter the printed coupon number.")
    hits = CouponUnit.objects.filter(club=club, status="ALLOCATED", number=n).select_related("batch")
    return Response([{"unit": u.id, "batch": u.batch.code, "color": u.batch.color, "number": u.number} for u in hits])


# =====================================================================  CUSTOMERS
def _customer_qs():
    return Customer.objects.filter(is_deleted=False).select_related("coach", "trial", "cvc")


@api_view(["GET", "POST"])
def customers(request):
    if request.method == "GET":
        qs = scoped(_customer_qs(), request)
        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(mobile__contains=q))
        limit = min(int(request.query_params.get("limit") or 200), 500)
        return Response([customer_json(c) for c in qs[:limit]])
    club = write_club(request, request.data)
    mobile = clean_mobile(request.data.get("mobile"))
    c = Customer.objects.create(club=club, name=text(request.data, "name", label="Customer name", max_len=120), mobile=mobile,
                                gender=text(request.data, "gender", False, max_len=10), dob=request.data.get("dob") or None,
                                notes=text(request.data, "notes", False, max_len=2000),
                                coach=coach_for(club, request.data.get("coach"), required=False), created_by=request.user)
    dup = Customer.objects.filter(club=club, mobile=mobile, is_deleted=False).exclude(pk=c.pk).count()
    audit(request, "create", "customer", c, after=customer_json(c))
    out = customer_json(_customer_qs().get(pk=c.pk), full=True)
    if dup:
        out["warning"] = f"{dup} other customer(s) in this club use the same mobile number. Check it's not a duplicate."
    return Response(out, status=201)


@api_view(["GET", "PATCH", "DELETE"])
def customer_detail(request, pk):
    c = get_scoped(Customer, request, pk)
    if c.is_deleted:
        raise Rule("That record doesn't exist.")
    if request.method == "GET":
        return Response(customer_json(_customer_qs().get(pk=c.pk), full=True))
    require_change(request.user, c) if request.method == "DELETE" else None
    if request.method == "DELETE":
        if c.issues.exists() or c.visits.exists() or hasattr(c, "trial"):
            raise Rule("This customer has coupons, visits or a trial on record, so they can't be deleted.")
        c.is_deleted, c.updated_by = True, request.user
        c.save()
        audit(request, "delete", "customer", c)
        return Response({"ok": True})
    # Profile edits are open to all staff of the club (SRS 7.3)
    if not request.user.is_admin and c.club_id != request.user.club_id:
        raise Forbidden("You can't edit this customer.")
    if not c.club.is_active:
        raise Forbidden(f"{c.club.name} is disabled.")
    before = customer_json(c)
    data = request.data
    if "name" in data:
        c.name = text(data, "name", label="Customer name", max_len=120)
    if "mobile" in data:
        c.mobile = clean_mobile(data.get("mobile"))
    for f in ("gender", "notes"):
        if f in data:
            setattr(c, f, text(data, f, False, max_len=2000))
    if "dob" in data:
        c.dob = data.get("dob") or None
    if "coach" in data:
        c.coach = coach_for(c.club, data.get("coach"), required=False)
    c.updated_by = request.user
    c.save()
    audit(request, "edit", "customer", c, before=before, after=customer_json(c))
    return Response(customer_json(_customer_qs().get(pk=c.pk), full=True))


# =====================================================================  TRIALS / CVC / WEEKLY
def _start_trial(request, cust):
    if hasattr(cust, "trial"):
        raise Rule(f"{cust.name} has already taken the 3-day trial.")
    if hasattr(cust, "cvc"):
        raise Rule(f"{cust.name} is already a CVC member.")
    # one trial per person across all clubs: same mobile AND same name means the same person
    other = Trial.objects.filter(customer__mobile=cust.mobile, customer__name__iexact=cust.name).exclude(customer=cust).select_related("club").first()
    if other:
        raise Rule("This person has already taken a 3-day trial" + (" at another club." if other.club_id != cust.club_id else "."))
    return Trial.objects.create(customer=cust, club=cust.club, created_by=request.user)


@api_view(["GET", "POST"])
def trials(request):
    if request.method == "GET":
        qs = scoped(Trial.objects.select_related("customer").order_by("-created_at"), request)
        return Response([trial_json(t) for t in qs[:300]])
    club = write_club(request, request.data)
    cust = customer_for(club, request.data.get("customer"))
    with transaction.atomic():
        t = _start_trial(request, cust)
    audit(request, "create", "trial", t)
    return Response(trial_json(t), status=201)


@api_view(["PATCH"])
def trial_detail(request, pk):
    t = get_scoped(Trial, request, pk)
    require_change(request.user, t)
    if hasattr(t.customer, "cvc"):
        raise Rule("This customer is already a CVC member, so trial attendance is locked.")
    days = request.data.get("days")
    if not isinstance(days, list) or len(days) != 3:
        raise Rule("Send attendance for all 3 days.")
    before = trial_json(t)
    t.day1, t.day2, t.day3 = (bool(x) for x in days)
    t.completed_at = timezone.now() if t.is_completed else None
    t.updated_by = request.user
    t.save()
    audit(request, "edit", "trial", t, before=before, after=trial_json(t))
    return Response(trial_json(t))


@api_view(["GET", "POST"])
def cvc(request):
    if request.method == "GET":
        qs = scoped(CvcMembership.objects.select_related("customer").order_by("-created_at"), request)
        return Response([{"id": m.id, "customer": m.customer_id, "customer_name": m.customer.name, "start_date": d(m.start_date),
                          "has_coupon": hasattr(m, "coupon")} for m in qs[:300]])
    club = write_club(request, request.data)
    cust = customer_for(club, request.data.get("customer"))
    trial = getattr(cust, "trial", None) if hasattr(cust, "trial") else None
    if not trial or not trial.is_completed:
        raise Rule("Only customers who attended all 3 trial days can join CVC.")
    if hasattr(cust, "cvc"):
        raise Rule(f"{cust.name} is already a CVC member.")
    try:
        start = timezone.datetime.fromisoformat(str(request.data.get("start_date"))).date()
    except ValueError:
        raise Rule("Choose the membership start date.")
    today = timezone.localdate()
    if start > today:
        raise Rule("The start date can't be in the future.")
    if start < today - timedelta(days=7):
        raise Rule("The start date must be within the last 7 days.")
    m = CvcMembership.objects.create(customer=cust, club=club, trial=trial, start_date=start, created_by=request.user)
    audit(request, "create", "cvc", m)
    return Response({"id": m.id, "customer": cust.id, "start_date": d(start)}, status=201)


@api_view(["GET", "POST"])
def weekly(request):
    if request.method == "GET":
        qs = scoped(WeeklyResult.objects.select_related("customer"), request)
        return Response([{"id": w.id, "customer": w.customer_id, "customer_name": w.customer.name, "week_start": d(w.week_start),
                          "weight": str(w.weight) if w.weight is not None else None, "waist": str(w.waist) if w.waist is not None else None,
                          "award_approved": w.award_approved, "has_coupon": hasattr(w, "coupon")} for w in qs[:300]])
    club = write_club(request, request.data)
    cust = customer_for(club, request.data.get("customer"))
    if not hasattr(cust, "cvc"):
        raise Rule("Weekly checkups are for CVC members.")
    try:
        week = timezone.datetime.fromisoformat(str(request.data.get("week_start"))).date()
    except ValueError:
        week = timezone.localdate() - timedelta(days=timezone.localdate().weekday())
    def num(k):
        v = request.data.get(k)
        try:
            return round(float(v), 1) if v not in (None, "") else None
        except ValueError:
            raise Rule(f"{k.capitalize()} must be a number.")
    w, _ = WeeklyResult.objects.update_or_create(customer=cust, week_start=week, defaults={
        "club": club, "weight": num("weight"), "waist": num("waist"), "notes": text(request.data, "notes", False), "created_by": request.user})
    audit(request, "save", "weekly_result", w)
    return Response({"id": w.id}, status=201)


@api_view(["POST"])
def weekly_approve(request, pk):
    if request.user.role == "SUPERVISOR":
        raise Forbidden("Only the Club Owner or Super Admin can approve Best Results awards.")
    w = get_scoped(WeeklyResult, request, pk)
    require_change(request.user, w)
    w.award_approved, w.approved_by = True, request.user
    w.save()
    audit(request, "approve_award", "weekly_result", w)
    return Response({"ok": True})


# =====================================================================  COUPON ISSUE
@api_view(["GET", "POST"])
def issues(request):
    if request.method == "GET":
        qs = scoped(CouponIssue.objects.select_related("unit__batch", "customer", "coach", "visit__visitor"), request)
        if request.query_params.get("open") == "1":       # waiting for a friend to visit
            qs = qs.filter(visit__isnull=True, is_paused=False)
        return Response([issue_json(i) for i in qs[:300]])

    club = write_club(request, request.data)
    data = request.data
    purpose = data.get("purpose")
    if purpose not in ("TRIAL", "CVC", "WEEKLY"):
        raise Rule("Choose what the coupon is for.")
    with transaction.atomic():
        cust = Customer.objects.select_for_update().filter(pk=data.get("customer"), club=club, is_deleted=False).first()
        if not cust:
            raise Rule("Choose a customer from this club.")
        # responsible coach: the customer's own coach, or the one picked now (then saved to the customer)
        coach = cust.coach or coach_for(club, data.get("coach"))
        if not cust.coach:
            cust.coach = coach
            cust.save(update_fields=["coach"])
        unit = CouponUnit.objects.select_for_update().select_related("batch").filter(pk=data.get("unit")).first()
        if not unit or unit.club_id != club.id:
            raise Rule("That coupon isn't in this club's stock.")
        if unit.status != "ALLOCATED":
            raise Rule(f"{unit.label()} has already been issued.")
        q = {}
        if purpose == "TRIAL":
            if hasattr(cust, "cvc"):
                raise Rule("This customer is a CVC member, so a trial coupon can't be given.")
            trial = cust.trial if hasattr(cust, "trial") else _start_trial(request, cust)
            if hasattr(trial, "coupon"):
                raise Rule("A trial coupon was already given to this customer.")
            q["trial"] = trial
        elif purpose == "CVC":
            trial = cust.trial if hasattr(cust, "trial") else None
            if not trial or not trial.is_completed:
                raise Rule("CVC coupons need a completed 3-day trial first.")
            if not hasattr(cust, "cvc"):
                raise Rule("Convert this customer to CVC first.")
            if hasattr(cust.cvc, "coupon"):
                raise Rule("A CVC coupon was already given to this customer.")
            q["cvc"] = cust.cvc
        else:
            if not hasattr(cust, "cvc"):
                raise Rule("Weekly Results coupons are for CVC members.")
            award = cust.weekly_results.filter(award_approved=True, coupon__isnull=True).first()
            if not award:
                raise Rule("This customer has no approved Best Results award waiting for a coupon.")
            q["weekly"] = award
        issue = CouponIssue.objects.create(unit=unit, customer=cust, club=club, purpose=purpose, coach=coach, created_by=request.user, **q)
        unit.status = "ISSUED"
        unit.save(update_fields=["status"])
    audit(request, "issue", "coupon_issue", issue, after={"coupon": unit.label(), "customer": cust.id, "purpose": purpose})
    return Response(issue_json(issue), status=201)


@api_view(["POST", "DELETE"])
def issue_detail(request, pk):
    i = get_scoped(CouponIssue, request, pk)
    require_change(request.user, i)
    if request.method == "DELETE":
        if hasattr(i, "visit"):
            raise Rule("A friend has already visited with this coupon, so it can't be removed.")
        with transaction.atomic():
            unit = i.unit
            label = unit.label()
            audit(request, "delete", "coupon_issue", i, before=issue_json(i))
            i.delete()
            unit.status = "ALLOCATED"
            unit.save(update_fields=["status"])
        return Response({"ok": True, "message": f"{label} is back in stock."})
    # POST = pause / resume a lost or stolen leaflet
    i.is_paused = not i.is_paused
    i.updated_by = request.user
    i.save()
    audit(request, "pause" if i.is_paused else "resume", "coupon_issue", i)
    return Response(issue_json(i))


# =====================================================================  REFERRAL VISITS & REDEMPTION
@api_view(["GET", "POST"])
def visits(request):
    if request.method == "GET":
        qs = scoped(ReferralVisit.objects.select_related("visitor", "issue__unit__batch", "coach").prefetch_related("redemptions"), request)
        out = [visit_json(v) for v in qs[:500]]
        if request.query_params.get("pending") == "1":    # hide fully redeemed
            out = [v for v in out if not (v["day1"] and v["day2"])]
        return Response(out)
    club = write_club(request, request.data)
    data = request.data
    with transaction.atomic():
        issue = CouponIssue.objects.select_for_update().select_related("customer", "unit__batch").filter(pk=data.get("issue")).first()
        if not issue or issue.club_id != club.id:
            raise Rule("This coupon was issued by another club. It can only be used at the club that issued it.")
        if issue.is_paused:
            raise Rule("This coupon is paused (reported lost). Resume it first.")
        if hasattr(issue, "visit"):
            raise Rule(f"{issue.unit.label()} already has a visitor: {issue.visit.visitor.name}.")
        visitor = customer_for(club, data.get("visitor"))
        inviter = issue.customer
        if visitor.id == inviter.id or visitor.mobile == inviter.mobile:
            raise Rule("A customer can't use their own coupon to refer themselves.")
        coach = coach_for(club, data.get("coach"))
        v = ReferralVisit.objects.create(issue=issue, visitor=visitor, club=club, coach=coach, inviter_name=inviter.name,
                                         inviter_mobile=inviter.mobile, created_by=request.user)
        if not visitor.coach:
            visitor.coach = coach
            visitor.save(update_fields=["coach"])
    audit(request, "register_visit", "referral_visit", v, after={"coupon": issue.unit.label(), "visitor": visitor.id})
    return Response(visit_json(v), status=201)


@api_view(["POST"])
def redemptions(request):
    club = write_club(request, request.data)
    try:
        day = int(request.data.get("day"))
    except (TypeError, ValueError):
        day = 0
    if day not in (1, 2):
        raise Rule("Choose Day 1 or Day 2.")
    with transaction.atomic():
        v = ReferralVisit.objects.select_for_update().select_related("issue").filter(pk=request.data.get("visit")).first()
        if not v or v.club_id != club.id or v.issue.club_id != club.id:
            raise Rule("This visitor belongs to another club. Coupons are redeemed only at the issuing club.")
        if v.issue.is_paused:
            raise Rule("This coupon is paused (reported lost).")
        done = set(v.redemptions.filter(is_void=False).values_list("day", flat=True))
        if day in done:
            raise Rule(f"Day {day} has already been redeemed for this coupon.")
        if day == 2 and 1 not in done:
            raise Rule("Day 1 must be redeemed before Day 2.")
        r = Redemption.objects.create(visit=v, club=club, day=day, created_by=request.user)
    audit(request, "redeem", "redemption", r, after={"visit": v.id, "day": day})
    return Response({"id": r.id, "day": day, "fully_redeemed": day == 2}, status=201)


@api_view(["POST"])
def redemption_void(request, pk):
    """Redemptions are never deleted. A mistake is corrected by voiding it with a reason; the record stays."""
    r = get_scoped(Redemption, request, pk)
    require_change(request.user, r)
    if r.is_void:
        raise Rule("This redemption is already corrected.")
    reason = text(request.data, "reason", label="A reason for the correction")
    if r.day == 1 and r.visit.redemptions.filter(day=2, is_void=False).exists():
        raise Rule("Correct the Day 2 entry first. Day 2 can't stay valid without Day 1.")
    r.is_void, r.void_reason, r.voided_by, r.voided_at = True, reason, request.user, timezone.now()
    r.save()
    audit(request, "void", "redemption", r, after={"reason": reason})
    return Response({"ok": True})


# =====================================================================  DASHBOARD, TREE, EXPORT
def _tree(club):
    """Who referred whom. Parent = coupon holder, child = the friend who visited with that coupon."""
    qs = ReferralVisit.objects.select_related("visitor", "issue__customer", "issue__unit__batch").prefetch_related("redemptions")
    if club:
        qs = qs.filter(club=club)
    children = defaultdict(list)
    visitors, people = set(), {}
    for v in qs:
        p, c = v.issue.customer, v.visitor
        people[p.id], people[c.id] = p, c
        days = {r.day for r in v.redemptions.all() if not r.is_void}
        children[p.id].append((c.id, v.issue.unit.label(), days))
        visitors.add(c.id)
    trial_done = set(Trial.objects.filter(customer_id__in=people, day1=True, day2=True, day3=True).values_list("customer_id", flat=True))
    in_trial = set(Trial.objects.filter(customer_id__in=people).values_list("customer_id", flat=True))
    cvc_ids = set(CvcMembership.objects.filter(customer_id__in=people).values_list("customer_id", flat=True))
    trees = []
    for root in [pid for pid in children if pid not in visitors]:
        nodes, seen, queue = [], {root}, deque([(root, 0, None, None, set())])
        while queue:
            pid, gen, coupon, parent, days = queue.popleft()
            per = people[pid]
            converted = pid in cvc_ids or pid in in_trial or 2 in days
            nodes.append({"id": pid, "name": per.name, "mobile": per.mobile, "generation": gen, "coupon": coupon,
                          "parent": parent, "day1": 1 in days, "day2": 2 in days, "trial": pid in in_trial,
                          "trial_done": pid in trial_done, "cvc": pid in cvc_ids, "converted": converted if gen else False})
            for cid, label, cdays in children.get(pid, []):
                if cid not in seen:                      # loop protection
                    seen.add(cid)
                    queue.append((cid, gen + 1, label, per.name, cdays))
        downline = [n for n in nodes if n["generation"] > 0]
        gens = defaultdict(int)
        for n in downline:
            gens[n["generation"]] += 1
        trees.append({"root": people[root].name, "root_id": root, "size": len(downline), "converted": sum(1 for n in downline if n["converted"]),
                      "depth": max([n["generation"] for n in nodes] or [0]), "generations": dict(gens), "nodes": nodes})
    trees.sort(key=lambda t: (-t["size"], -t["converted"]))
    return trees


def _pct(a, b):
    return min(100, round(a / b * 100)) if b else 0


@api_view(["GET"])
@permission_classes([NotSupervisor])
def dashboard(request):
    club = read_club(request)
    f = (lambda qs: qs.filter(club=club)) if club else (lambda qs: qs)
    issued = f(CouponIssue.objects.all()).count()
    visits_n = f(ReferralVisit.objects.all()).count()
    reds = f(Redemption.objects.filter(is_void=False))
    d1, d2 = reds.filter(day=1).count(), reds.filter(day=2).count()
    trials_q = f(Trial.objects.all())
    trials_n = trials_q.count()
    trials_done = trials_q.filter(day1=True, day2=True, day3=True).count()
    cvc_n = f(CvcMembership.objects.all()).count()
    customers_n = f(Customer.objects.filter(is_deleted=False)).count()
    stock_n = f(CouponUnit.objects.filter(status="ALLOCATED")).count()
    successful_refs = f(ReferralVisit.objects.filter(
        Q(redemptions__day=2, redemptions__is_void=False) | Q(visitor__trial__isnull=False) | Q(visitor__cvc__isnull=False))).distinct().count()
    funnel = [["Coupons issued", issued], ["Referral visits", visits_n], ["Day 1 redeemed", d1], ["Day 2 redeemed", d2],
              ["Trials enrolled", trials_n], ["Trials completed", trials_done], ["CVC conversions", cvc_n]]
    coaches_q = f(Coach.objects.all())
    board = []
    for c in coaches_q:
        ci = CouponIssue.objects.filter(coach=c).count()
        ct = Trial.objects.filter(customer__coach=c).count()
        cd = Trial.objects.filter(customer__coach=c, day1=True, day2=True, day3=True).count()
        cc = CvcMembership.objects.filter(customer__coach=c).count()
        board.append({"name": c.name, "herbalife_id": c.herbalife_id, "issued": ci, "trials": ct, "trials_done": cd, "cvc": cc,
                      "efficiency": _pct(cc, cd or ct)})
    board.sort(key=lambda b: (-b["cvc"], -b["issued"]))
    since = timezone.localdate() - timedelta(days=6)
    trend = defaultdict(lambda: [0, 0])
    for day, created in reds.filter(created_at__date__gte=since).values_list("day", "created_at"):
        trend[timezone.localtime(created).date()][day - 1] += 1
    out = {
        "scope": club.name if club else "All clubs",
        "kpis": {"customers": customers_n, "issued": issued, "visits": visits_n, "d1": d1, "d2": d2, "trials": trials_n,
                 "trials_done": trials_done, "cvc": cvc_n, "stock": stock_n},
        "conversion": {"customer": _pct(max(trials_n, cvc_n), customers_n), "trial_to_cvc": _pct(cvc_n, trials_done or trials_n),
                       "coupon_use": _pct(d1, issued), "referral": _pct(successful_refs, visits_n)},
        "funnel": funnel, "coaches": board,
        "trend": [{"date": (since + timedelta(days=i)).isoformat(), "day1": trend[since + timedelta(days=i)][0],
                   "day2": trend[since + timedelta(days=i)][1]} for i in range(7)],
        "top_inviters": [{"name": t["root"], "size": t["size"], "converted": t["converted"]} for t in _tree(club)[:5]],
    }
    if request.user.is_admin and not club:
        out["clubs"] = [club_json(c, _club_stats(c)) for c in Club.objects.prefetch_related("staff")]
        out["pending_resets"] = PasswordResetRequest.objects.filter(status="PENDING").count()
        out["batches"] = PrintBatch.objects.count()
    return Response(out)


@api_view(["GET"])
@permission_classes([NotSupervisor])
def referral_tree(request):
    return Response(_tree(read_club(request)))


@api_view(["GET"])
@permission_classes([NotSupervisor])
def export_csv(request):
    club = read_club(request)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Shreyas Wellness World — coupon report", club.name if club else "All clubs", timezone.localtime().strftime("%d %b %Y %H:%M")])
    w.writerow([])
    w.writerow(["COUPONS ISSUED"])
    w.writerow(["Coupon", "Club", "Customer", "Mobile", "Purpose", "Coach", "Issued", "Visitor", "Day 1", "Day 2"])
    qs = CouponIssue.objects.select_related("unit__batch", "club", "customer", "coach", "visit__visitor").prefetch_related("visit__redemptions")
    if club:
        qs = qs.filter(club=club)
    for i in qs:
        v = i.visit if hasattr(i, "visit") else None
        days = {r.day for r in v.redemptions.all() if not r.is_void} if v else set()
        w.writerow([i.unit.label(), i.club.name, i.customer.name, i.customer.mobile, i.get_purpose_display(), i.coach.name,
                    timezone.localtime(i.created_at).strftime("%d-%m-%Y"), v.visitor.name if v else "", "Yes" if 1 in days else "", "Yes" if 2 in days else ""])
    w.writerow([])
    w.writerow(["REFERRAL CHAINS"])
    w.writerow(["Started by", "Person", "Generation", "Referred by", "Coupon", "Converted"])
    for t in _tree(club):
        for n in t["nodes"]:
            w.writerow([t["root"], n["name"], "Root" if n["generation"] == 0 else f"G{n['generation']}", n["parent"] or "", n["coupon"] or "", "Yes" if n["converted"] else ""])
    resp = HttpResponse("﻿" + buf.getvalue(), content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="coupon-report-{timezone.localdate().isoformat()}.csv"'
    return resp


@api_view(["GET"])
@permission_classes([AdminOnly])
def audit_log(request):
    qs = AuditLog.objects.select_related("actor", "club")[:300]
    return Response([{"at": d(a.created_at), "who": a.actor.username if a.actor else "", "club": a.club.name if a.club else "",
                      "action": a.action, "entity": a.entity, "entity_id": a.entity_id} for a in qs])
