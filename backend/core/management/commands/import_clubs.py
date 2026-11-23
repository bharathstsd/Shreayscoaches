"""Create clubs, Club Owner logins and coaches from an Excel file (same rules as the
Super Admin's "Import from Excel" page).

  Check only (changes nothing):   python manage.py import_clubs clubs.xlsx
  Create everything:              python manage.py import_clubs clubs.xlsx --commit

With --commit it writes a logins file (username, temporary password, WhatsApp message)
next to the Excel file. Share the messages, then delete that file: it contains passwords."""
import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core import importer


class Command(BaseCommand):
    help = "Import clubs, Club Owner logins and coaches from Excel (dry run unless --commit)."

    def add_arguments(self, p):
        p.add_argument("xlsx")
        p.add_argument("--commit", action="store_true", help="Actually create the records.")
        p.add_argument("--expires-hours", type=int, default=72, help="How long the temporary passwords work (default 72).")

    def handle(self, xlsx, commit, expires_hours, **kw):
        path = Path(xlsx)
        if not path.exists():
            raise CommandError(f"File not found: {xlsx}")
        try:
            with open(path, "rb") as f:
                plan, errors, s = importer.check(importer.open_workbook(f))
        except importer.ImportError_ as e:
            raise CommandError(str(e))
        self.stdout.write(f"Found {s['clubs']} club(s) ({s['new_clubs']} new), {s['owners']} Club Owner login(s), "
                          f"{s['coaches']} new coach(es)" + (f", {s['coaches_skipped']} coach(es) already in the app" if s["coaches_skipped"] else "") + ".")
        if errors:
            self.stdout.write(self.style.ERROR(f"\n{len(errors)} problem(s) to fix in the Excel file:"))
            for e in errors:
                self.stdout.write("  - " + e)
            raise CommandError("Nothing was created. Fix the rows above and run again.")
        if not commit:
            self.stdout.write(self.style.SUCCESS("\nEverything looks good. Run again with --commit to create them."))
            return
        res = importer.create(plan, expires_hours)
        out = path.with_name(f"logins-{timezone.localdate().isoformat()}.csv")
        if res["logins"]:
            with open(out, "w", newline="", encoding="utf-8-sig") as f:
                w = csv.writer(f)
                w.writerow(["Club", "Club Owner", "Mobile", "Username", "Temporary password", "WhatsApp message"])
                for l in res["logins"]:
                    w.writerow([l["club"], l["name"], l["mobile"], l["username"], l["password"], l["message"]])
            out.chmod(0o600)
        self.stdout.write(self.style.SUCCESS(f"\nCreated {s['new_clubs']} club(s), {len(res['logins'])} Club Owner login(s) and {res['coaches_created']} coach(es)."))
        if res["logins"]:
            self.stdout.write(f"Logins and WhatsApp messages: {out}")
            self.stdout.write(f"Temporary passwords work for {expires_hours} hours. Delete that file once you've sent the messages.")
