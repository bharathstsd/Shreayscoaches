"""Excel import of clubs, Club Owner logins and coaches — shared by the Super Admin
upload page (/api/import) and the `import_clubs` server command.

Sheets (template: deploy/club-import-template.xlsx):
  Clubs   — Club name, City, Address, Pincode, Owner name, Owner mobile, Owner Herbalife ID,
            Upline / sponsor name, Upline / sponsor mobile, Upline / sponsor Herbalife ID
  Coaches — Club name, Coach name, Coach mobile, Coach Herbalife ID,
            Upline / sponsor name, Upline / sponsor mobile, Upline / sponsor Herbalife ID
Either sheet may be left empty, but not both. Nothing is created unless every row is valid."""
import re
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import AuditLog, Club, Coach, User

MOBILE = re.compile(r"^[6-9]\d{9}$")
UPLINE = ["upline name", "upline mobile", "upline herbalife id"]
CLUB_COLS = ["club name", "city", "address", "pincode", "owner name", "owner mobile", "owner herbalife id"] + UPLINE
COACH_COLS = ["club name", "coach name", "coach mobile", "coach herbalife id"] + UPLINE
REQUIRED_CLUB = ["club name", "owner name", "owner mobile", "owner herbalife id"] + UPLINE
REQUIRED_COACH = ["club name", "coach name", "coach mobile", "coach herbalife id"] + UPLINE


class ImportError_(Exception):
    """The file itself can't be read (wrong format or columns)."""


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()


def _mobile(v):
    m = re.sub(r"\D", "", _cell(v))
    if len(m) == 12 and m.startswith("91"):
        m = m[2:]
    return m


def _sheet(wb, name, cols):
    if name not in wb.sheetnames:
        return []
    rows = list(wb[name].iter_rows(values_only=True))
    if not rows:
        return []
    header = [_cell(h).lower().replace("/ sponsor ", "").replace("sponsor ", "upline ") for h in rows[0]]
    missing = [c for c in cols if c not in header]
    if missing:
        raise ImportError_(f'Sheet "{name}" is missing columns: {", ".join(missing)}. Download the latest template.')
    idx = {c: header.index(c) for c in cols}
    out = []
    for n, r in enumerate(rows[1:], start=2):
        rec = {c: _cell(r[idx[c]]) if idx[c] < len(r) else "" for c in cols}
        if not any(rec.values()) or rec["club name"].lower().startswith("example"):
            continue
        rec["_row"] = n
        out.append(rec)
    return out


def _person(errors, where, who, mob, hid):
    if mob and not MOBILE.match(mob):
        errors.append(f"{where}: {who} mobile {mob} isn't a 10-digit number starting 6–9.")
    if hid and not re.match(r"^[A-Za-z0-9-]{3,40}$", hid):
        errors.append(f'{where}: {who} Herbalife ID "{hid}" should be letters and numbers only.')


def open_workbook(fileobj):
    from openpyxl import load_workbook
    try:
        return load_workbook(fileobj, data_only=True, read_only=True)
    except Exception:
        raise ImportError_("This isn't an .xlsx Excel file. In Excel use File → Save As → Excel Workbook (.xlsx), then upload again.")


def check(wb):
    """Read and validate. Returns (plan, errors, summary)."""
    clubs = _sheet(wb, "Clubs", CLUB_COLS)
    coaches = _sheet(wb, "Coaches", COACH_COLS)
    if "Clubs" not in wb.sheetnames and "Coaches" not in wb.sheetnames:
        raise ImportError_('The file needs a sheet named "Clubs" and/or "Coaches". Download the template.')
    errors, club_plan = [], []
    seen_user, seen_mobile, names = set(), set(), set()
    for r in clubs:
        where = f'Clubs row {r["_row"]}'
        empty = [c for c in REQUIRED_CLUB if not r[c]]
        if empty:
            errors.append(f"{where}: fill in {', '.join(empty)}.")
            continue
        name = r["club name"]
        if name.lower() in names:
            errors.append(f'{where}: "{name}" appears twice.')
        names.add(name.lower())
        om, um = _mobile(r["owner mobile"]), _mobile(r["upline mobile"])
        _person(errors, where, "Owner", om, r["owner herbalife id"])
        _person(errors, where, "Upline", um, r["upline herbalife id"])
        uname = re.sub(r"[^a-z0-9-]", "", r["owner herbalife id"].lower())
        if uname in seen_user or User.objects.filter(username__iexact=uname).exists():
            errors.append(f'{where}: Herbalife ID {r["owner herbalife id"]} already has a login.')
        if om in seen_mobile or User.objects.filter(mobile=om).exists():
            errors.append(f"{where}: mobile {om} is already used by another login.")
        existing = Club.objects.filter(name__iexact=name).first()
        if existing and User.objects.filter(club=existing, role="OWNER", is_active=True).exists():
            errors.append(f"{where}: {name} already has an active Club Owner.")
        if existing and not existing.is_active:
            errors.append(f"{where}: {name} is disabled. Enable it first.")
        seen_user.add(uname)
        seen_mobile.add(om)
        first, _, last = r["owner name"].partition(" ")
        club_plan.append({"row": r, "existing_id": existing.id if existing else None, "username": uname, "mobile": om, "first": first, "last": last,
                          "upline": {"upline_name": r["upline name"], "upline_mobile": um, "upline_herbalife_id": r["upline herbalife id"]}})
    coach_plan, seen_coach = [], set()
    for r in coaches:
        where = f'Coaches row {r["_row"]}'
        empty = [c for c in REQUIRED_COACH if not r[c]]
        if empty:
            errors.append(f"{where}: fill in {', '.join(empty)}.")
            continue
        club = Club.objects.filter(name__iexact=r["club name"]).first()
        if r["club name"].lower() not in names and not club:
            errors.append(f'{where}: club "{r["club name"]}" isn\'t in the Clubs sheet or the app.')
        elif club and not club.is_active:
            errors.append(f'{where}: {club.name} is disabled. Enable it first.')
        cm, um = _mobile(r["coach mobile"]), _mobile(r["upline mobile"])
        _person(errors, where, "Coach", cm, r["coach herbalife id"])
        _person(errors, where, "Upline", um, r["upline herbalife id"])
        key = (r["club name"].lower(), cm)
        dup = key in seen_coach or (club and Coach.objects.filter(club=club, mobile=cm).exists())
        seen_coach.add(key)
        coach_plan.append({**r, "mobile": cm, "skip": bool(dup),
                           "upline": {"upline_name": r["upline name"], "upline_mobile": um, "upline_herbalife_id": r["upline herbalife id"]}})
    if not clubs and not coaches:
        errors.append("The sheets are empty. Fill in at least one club or coach (example rows are ignored).")
    summary = {"clubs": len(club_plan), "new_clubs": sum(1 for p in club_plan if not p["existing_id"]), "owners": len(club_plan),
               "coaches": sum(1 for c in coach_plan if not c["skip"]), "coaches_skipped": sum(1 for c in coach_plan if c["skip"]),
               "rows": [{"club": p["row"]["club name"], "owner": p["row"]["owner name"], "mobile": p["mobile"], "herbalife_id": p["row"]["owner herbalife id"],
                         "upline": p["row"]["upline name"], "new_club": not p["existing_id"]} for p in club_plan],
               "coach_rows": [{"club": c["club name"], "coach": c["coach name"], "mobile": c["mobile"], "upline": c["upline name"], "skip": c["skip"]} for c in coach_plan]}
    return {"clubs": club_plan, "coaches": coach_plan}, errors, summary


def create(plan, expires_hours=72, actor=None):
    """Create everything in one transaction. Returns the new logins (with one-time passwords)."""
    from .views import temp_password
    expires = timezone.now() + timedelta(hours=expires_hours)
    exp_txt = timezone.localtime(expires).strftime("%d %b %Y, %I:%M %p")
    logins, club_by_name = [], {}
    with transaction.atomic():
        for p in plan["clubs"]:
            r = p["row"]
            club = Club.objects.get(pk=p["existing_id"]) if p["existing_id"] else Club.objects.create(
                name=r["club name"], city=r["city"], address=r["address"], pincode=r["pincode"][:10], owner_name=r["owner name"], owner_mobile=p["mobile"])
            club_by_name[club.name.lower()] = club
            if not p["existing_id"]:
                AuditLog.objects.create(actor=actor, action="import_create", entity="club", entity_id=str(club.pk), club=club)
            pw = temp_password()
            u = User(username=p["username"], first_name=p["first"], last_name=p["last"], role="OWNER", club=club, mobile=p["mobile"],
                     herbalife_id=r["owner herbalife id"], must_change_password=True, temp_password_expires=expires, **p["upline"])
            u.set_password(pw)
            u.save()
            AuditLog.objects.create(actor=actor, action="import_create", entity="user", entity_id=str(u.pk), club=club)
            msg = (f"Hello {r['owner name']},\nYour Club Owner login for the Shreyas Wellness World Coupon System ({club.name}):\n"
                   f"Username: {p['username']} (or your mobile {p['mobile']})\nTemporary Password: {pw}\n"
                   f"Please log in and set your own password. This password expires on {exp_txt}.")
            logins.append({"club": club.name, "name": r["owner name"], "mobile": p["mobile"], "username": p["username"], "password": pw, "message": msg})
        made = 0
        for c in plan["coaches"]:
            if c["skip"]:
                continue
            club = club_by_name.get(c["club name"].lower()) or Club.objects.get(name__iexact=c["club name"])
            coach = Coach.objects.create(club=club, name=c["coach name"], mobile=c["mobile"], herbalife_id=c["coach herbalife id"], created_by=actor, **c["upline"])
            AuditLog.objects.create(actor=actor, action="import_create", entity="coach", entity_id=str(coach.pk), club=club)
            made += 1
    return {"logins": logins, "coaches_created": made, "expires": expires.isoformat(), "expires_hours": expires_hours}
