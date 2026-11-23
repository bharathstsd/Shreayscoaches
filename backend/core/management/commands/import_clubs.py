"""Create clubs, their Club Owner / Supervisor logins and coaches from an Excel file.

  Check only (changes nothing):   python manage.py import_clubs clubs.xlsx
  Create everything:              python manage.py import_clubs clubs.xlsx --commit

Uses the template deploy/club-import-template.xlsx (sheets "Clubs" and "Coaches").
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
CLUB_COLS = ["club name", "city", "address", "pincode",
             "owner name", "owner username", "owner mobile", "owner herbalife id",
             "supervisor name", "supervisor username", "supervisor mobile", "supervisor herbalife id"]
COACH_COLS = ["club name", "coach name", "coach mobile", "herbalife id"]


def cell(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


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
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    header = [cell(h).lower() for h in rows[0]]
    missing = [c for c in cols if c not in header]
    if missing:
        raise CommandError(f'Sheet "{name}" is missing columns: {", ".join(missing)}. Use the template.')
    idx = {c: header.index(c) for c in cols}
    out = []
    for n, r in enumerate(rows[1:], start=2):
        rec = {c: cell(r[idx[c]]) if idx[c] < len(r) else "" for c in cols}
        if not any(rec.values()) or rec["club name"].lower().startswith("example"):
            continue
        rec["_row"] = n
        out.append(rec)
    return out


class Command(BaseCommand):
    help = "Import clubs, staff logins and coaches from Excel (dry run unless --commit)."

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
        seen_user, seen_mobile = set(), set()
        names_in_file = set()
        for r in clubs:
            where = f'Clubs row {r["_row"]}'
            name = r["club name"]
            if not name:
                errors.append(f"{where}: club name is empty.")
                continue
            if name.lower() in names_in_file:
                errors.append(f'{where}: "{name}" appears twice.')
            names_in_file.add(name.lower())
            existing = Club.objects.filter(name__iexact=name).first()
            people = []
            for role, key in (("OWNER", "owner"), ("SUPERVISOR", "supervisor")):
                full, uname, mob, hid = r[f"{key} name"], r[f"{key} username"].lower(), mobile(r[f"{key} mobile"]), r[f"{key} herbalife id"]
                if not (full or uname or mob or hid):
                    continue                                   # this role left blank on purpose
                label = "Owner" if role == "OWNER" else "Supervisor"
                if not (full and uname and mob and hid):
                    errors.append(f"{where}: {label} needs name, username, mobile and Herbalife ID (or leave all four empty).")
                    continue
                if not re.match(r"^[a-z0-9._-]{3,30}$", uname):
                    errors.append(f'{where}: {label} username "{uname}" should be 3–30 letters, numbers, dots or dashes, no spaces.')
                if not MOBILE.match(mob):
                    errors.append(f"{where}: {label} mobile {r[key + ' mobile']} isn't a 10-digit number starting 6–9.")
                if uname in seen_user or User.objects.filter(username__iexact=uname).exists():
                    errors.append(f'{where}: username "{uname}" is already taken.')
                if mob in seen_mobile or User.objects.filter(mobile=mob).exists():
                    errors.append(f"{where}: mobile {mob} is already used by another login.")
                if existing and User.objects.filter(club=existing, role=role, is_active=True).exists():
                    errors.append(f"{where}: {name} already has an active {label}.")
                seen_user.add(uname)
                seen_mobile.add(mob)
                first, _, last = full.partition(" ")
                people.append({"role": role, "label": label, "first": first, "last": last, "username": uname, "mobile": mob, "hid": hid})
            plan.append({"row": r, "existing": existing, "people": people})

        coach_plan = []
        for r in coaches:
            where = f'Coaches row {r["_row"]}'
            if r["club name"].lower() not in names_in_file and not Club.objects.filter(name__iexact=r["club name"]).exists():
                errors.append(f'{where}: club "{r["club name"]}" isn\'t in the Clubs sheet or the app.')
            if not r["coach name"]:
                errors.append(f"{where}: coach name is empty.")
            m = mobile(r["coach mobile"])
            if not MOBILE.match(m):
                errors.append(f"{where}: coach mobile {r['coach mobile']} isn't a 10-digit number starting 6–9.")
            coach_plan.append({**r, "mobile": m})

        new_clubs = sum(1 for p in plan if not p["existing"])
        logins = sum(len(p["people"]) for p in plan)
        self.stdout.write(f"Found {len(plan)} club(s) ({new_clubs} new), {logins} login(s), {len(coach_plan)} coach(es).")
        if errors:
            self.stdout.write(self.style.ERROR(f"\n{len(errors)} problem(s) to fix in the Excel file:"))
            for e in errors:
                self.stdout.write("  - " + e)
            raise CommandError("Nothing was created. Fix the rows above and run again.")
        if not commit:
            self.stdout.write(self.style.SUCCESS("\nEverything looks good. Run again with --commit to create them."))
            return

        expires = timezone.now() + timedelta(hours=expires_hours)
        out_rows = []
        with transaction.atomic():
            club_by_name = {}
            for p in plan:
                r = p["row"]
                club = p["existing"] or Club.objects.create(name=r["club name"], city=r["city"], address=r["address"], pincode=r["pincode"][:10],
                                                            owner_name=next((x["first"] + (" " + x["last"] if x["last"] else "") for x in p["people"] if x["role"] == "OWNER"), ""),
                                                            owner_mobile=next((x["mobile"] for x in p["people"] if x["role"] == "OWNER"), ""))
                club_by_name[club.name.lower()] = club
                if not p["existing"]:
                    AuditLog.objects.create(action="import_create", entity="club", entity_id=str(club.pk), club=club)
                for x in p["people"]:
                    pw = temp_password()
                    u = User(username=x["username"], first_name=x["first"], last_name=x["last"], role=x["role"], club=club, mobile=x["mobile"],
                             herbalife_id=x["hid"], must_change_password=True, temp_password_expires=expires)
                    u.set_password(pw)
                    u.save()
                    AuditLog.objects.create(action="import_create", entity="user", entity_id=str(u.pk), club=club)
                    name = (x["first"] + " " + x["last"]).strip()
                    msg = (f"Hello {name},\nYour login for the Shreyas Wellness World Coupon System ({x['label']}, {club.name}):\n"
                           f"Username: {x['username']}\nTemporary Password: {pw}\n"
                           f"Please log in and set your own password. This password expires on {timezone.localtime(expires).strftime('%d %b %Y, %I:%M %p')}.")
                    out_rows.append([club.name, x["label"], name, x["mobile"], x["username"], pw, msg])
            for r in coach_plan:
                club = club_by_name.get(r["club name"].lower()) or Club.objects.get(name__iexact=r["club name"])
                if not Coach.objects.filter(club=club, mobile=r["mobile"]).exists():
                    Coach.objects.create(club=club, name=r["coach name"], mobile=r["mobile"], herbalife_id=r["herbalife id"])

        out = path.with_name(f"logins-{timezone.localdate().isoformat()}.csv")
        with open(out, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["Club", "Role", "Name", "Mobile", "Username", "Temporary password", "WhatsApp message"])
            w.writerows(out_rows)
        out.chmod(0o600)
        self.stdout.write(self.style.SUCCESS(f"\nCreated {new_clubs} club(s), {len(out_rows)} login(s) and the coaches."))
        self.stdout.write(f"Logins and WhatsApp messages: {out}")
        self.stdout.write(f"Temporary passwords work for {expires_hours} hours. Delete that file once you've sent the messages.")
