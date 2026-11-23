"""Create clubs, their Club Owner logins and coaches from an Excel file.

  Check only (changes nothing):   python manage.py import_clubs clubs.xlsx
  Create everything:              python manage.py import_clubs clubs.xlsx --commit

Uses the template deploy/club-import-template.xlsx (sheets "Clubs" and "Coaches").
Required for every Club Owner and every coach: name, mobile, Herbalife ID, and their
upline / sponsor's name, mobile and Herbalife ID. The Owner's username is their Herbalife ID
(they can also log in with their mobile).

With --commit it writes a logins file (username, temporary password, WhatsApp message)
next to the Excel file. Share the messages, then delete that file: it contains passwords."""
import csv
import re
from datetime import timedelta
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.models import AuditLog, Club, Coach, User
from core.views import temp_password

MOBILE = re.compile(r"^[6-9]\d{9}$")
UPLINE = ["upline name", "upline mobile", "upline herbalife id"]
CLUB_COLS = ["club name", "city", "address", "pincode", "owner name", "owner mobile", "owner herbalife id"] + UPLINE
COACH_COLS = ["club name", "coach name", "coach mobile", "coach herbalife id"] + UPLINE
REQUIRED_CLUB = ["club name", "owner name", "owner mobile", "owner herbalife id"] + UPLINE
REQUIRED_COACH = ["club name", "coach name", "coach mobile", "coach herbalife id"] + UPLINE


def cell(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()


def mobile(v):
    m = re.sub(r"\D", "", cell(v))
    if len(m) == 12 and m.startswith("91"):
        m = m[2:]
    return m


def read_sheet(wb, name, cols, required):
    if name not in wb.sheetnames:
        if required:
            raise CommandError(f'The Excel file needs a sheet named "{name}".')
        return []
    rows = list(wb[name].iter_rows(values_only=True))
    if not rows:
        return []
    header = [cell(h).lower().replace("/ sponsor ", "").replace("sponsor ", "upline ") for h in rows[0]]
    missing = [c for c in cols if c not in header]
    if missing:
        raise CommandError(f'Sheet "{name}" is missing columns: {", ".join(missing)}. Use the latest template.')
    idx = {c: header.index(c) for c in cols}
    out = []
    for n, r in enumerate(rows[1:], start=2):
        rec = {c: cell(r[idx[c]]) if idx[c] < len(r) else "" for c in cols}
        if not any(rec.values()) or rec["club name"].lower().startswith("example"):
            continue
        rec["_row"] = n
        out.append(rec)
    return out


def check_person(errors, where, who, name, mob, hid):
    if mob and not MOBILE.match(mob):
        errors.append(f"{where}: {who} mobile {mob} isn't a 10-digit number starting 6–9.")
    if hid and not re.match(r"^[A-Za-z0-9-]{3,40}$", hid):
        errors.append(f'{where}: {who} Herbalife ID "{hid}" should be letters and numbers only.')


class Command(BaseCommand):
    help = "Import clubs, Club Owner logins and coaches from Excel (dry run unless --commit)."

    def add_arguments(self, p):
        p.add_argument("xlsx")
        p.add_argument("--commit", action="store_true", help="Actually create the records.")
        p.add_argument("--expires-hours", type=int, default=72, help="How long the temporary passwords work (default 72).")

    def handle(self, xlsx, commit, expires_hours, **kw):
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise CommandError("openpyxl is missing. Run: venv/bin/pip install -r backend/requirements.txt")
        path = Path(xlsx)
        if not path.exists():
            raise CommandError(f"File not found: {xlsx}")
        wb = load_workbook(path, data_only=True)
        clubs = read_sheet(wb, "Clubs", CLUB_COLS, True)
        coaches = read_sheet(wb, "Coaches", COACH_COLS, False)

        errors, plan = [], []
        seen_user, seen_mobile, names_in_file = set(), set(), set()
        for r in clubs:
            where = f'Clubs row {r["_row"]}'
            empty = [c for c in REQUIRED_CLUB if not r[c]]
            if empty:
                errors.append(f"{where}: fill in {', '.join(empty)}.")
                continue
            name = r["club name"]
            if name.lower() in names_in_file:
                errors.append(f'{where}: "{name}" appears twice.')
            names_in_file.add(name.lower())
            om, um = mobile(r["owner mobile"]), mobile(r["upline mobile"])
            check_person(errors, where, "Owner", r["owner name"], om, r["owner herbalife id"])
            check_person(errors, where, "Upline", r["upline name"], um, r["upline herbalife id"])
            uname = re.sub(r"[^a-z0-9-]", "", r["owner herbalife id"].lower())
            if uname in seen_user or User.objects.filter(username__iexact=uname).exists():
                errors.append(f'{where}: Herbalife ID {r["owner herbalife id"]} already has a login.')
            if om in seen_mobile or User.objects.filter(mobile=om).exists():
                errors.append(f"{where}: mobile {om} is already used by another login.")
            existing = Club.objects.filter(name__iexact=name).first()
            if existing and User.objects.filter(club=existing, role="OWNER", is_active=True).exists():
                errors.append(f"{where}: {name} already has an active Club Owner.")
            seen_user.add(uname)
            seen_mobile.add(om)
            first, _, last = r["owner name"].partition(" ")
            plan.append({"row": r, "existing": existing, "username": uname, "mobile": om, "first": first, "last": last,
                         "upline": {"upline_name": r["upline name"], "upline_mobile": um, "upline_herbalife_id": r["upline herbalife id"]}})

        coach_plan = []
        for r in coaches:
            where = f'Coaches row {r["_row"]}'
            empty = [c for c in REQUIRED_COACH if not r[c]]
            if empty:
                errors.append(f"{where}: fill in {', '.join(empty)}.")
                continue
            if r["club name"].lower() not in names_in_file and not Club.objects.filter(name__iexact=r["club name"]).exists():
                errors.append(f'{where}: club "{r["club name"]}" isn\'t in the Clubs sheet or the app.')
            cm, um = mobile(r["coach mobile"]), mobile(r["upline mobile"])
            check_person(errors, where, "Coach", r["coach name"], cm, r["coach herbalife id"])
            check_person(errors, where, "Upline", r["upline name"], um, r["upline herbalife id"])
            coach_plan.append({**r, "mobile": cm, "upline": {"upline_name": r["upline name"], "upline_mobile": um, "upline_herbalife_id": r["upline herbalife id"]}})

        new_clubs = sum(1 for p in plan if not p["existing"])
        self.stdout.write(f"Found {len(plan)} club(s) ({new_clubs} new), {len(plan)} Club Owner login(s), {len(coach_plan)} coach(es).")
        if errors:
            self.stdout.write(self.style.ERROR(f"\n{len(errors)} problem(s) to fix in the Excel file:"))
            for e in errors:
                self.stdout.write("  - " + e)
            raise CommandError("Nothing was created. Fix the rows above and run again.")
        if not commit:
            self.stdout.write(self.style.SUCCESS("\nEverything looks good. Run again with --commit to create them."))
            return

        expires = timezone.now() + timedelta(hours=expires_hours)
        out_rows, club_by_name = [], {}
        with transaction.atomic():
            for p in plan:
                r = p["row"]
                owner_name = r["owner name"]
                club = p["existing"] or Club.objects.create(name=r["club name"], city=r["city"], address=r["address"], pincode=r["pincode"][:10],
                                                            owner_name=owner_name, owner_mobile=p["mobile"])
                club_by_name[club.name.lower()] = club
                if not p["existing"]:
                    AuditLog.objects.create(action="import_create", entity="club", entity_id=str(club.pk), club=club)
                pw = temp_password()
                u = User(username=p["username"], first_name=p["first"], last_name=p["last"], role="OWNER", club=club, mobile=p["mobile"],
                         herbalife_id=r["owner herbalife id"], must_change_password=True, temp_password_expires=expires, **p["upline"])
                u.set_password(pw)
                u.save()
                AuditLog.objects.create(action="import_create", entity="user", entity_id=str(u.pk), club=club)
                msg = (f"Hello {owner_name},\nYour Club Owner login for the Shreyas Wellness World Coupon System ({club.name}):\n"
                       f"Username: {p['username']} (or your mobile {p['mobile']})\nTemporary Password: {pw}\n"
                       f"Please log in and set your own password. This password expires on {timezone.localtime(expires).strftime('%d %b %Y, %I:%M %p')}.")
                out_rows.append([club.name, owner_name, p["mobile"], p["username"], pw, msg])
            for r in coach_plan:
                club = club_by_name.get(r["club name"].lower()) or Club.objects.get(name__iexact=r["club name"])
                if not Coach.objects.filter(club=club, mobile=r["mobile"]).exists():
                    Coach.objects.create(club=club, name=r["coach name"], mobile=r["mobile"], herbalife_id=r["coach herbalife id"], **r["upline"])

        out = path.with_name(f"logins-{timezone.localdate().isoformat()}.csv")
        with open(out, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["Club", "Club Owner", "Mobile", "Username", "Temporary password", "WhatsApp message"])
            w.writerows(out_rows)
        out.chmod(0o600)
        self.stdout.write(self.style.SUCCESS(f"\nCreated {new_clubs} club(s), {len(out_rows)} Club Owner login(s) and {len(coach_plan)} coach(es)."))
        self.stdout.write(f"Logins and WhatsApp messages: {out}")
        self.stdout.write(f"Temporary passwords work for {expires_hours} hours. Delete that file once you've sent the messages.")
