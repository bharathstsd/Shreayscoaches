"""Create the Super Admin account, or reset its password (the controlled recovery route from SRS 4.6).
   python manage.py create_superadmin --username giri --mobile 9676011011"""
import getpass

from django.core.management.base import BaseCommand, CommandError

from core.models import User


class Command(BaseCommand):
    help = "Create the Super Admin, or reset the Super Admin password."

    def add_arguments(self, p):
        p.add_argument("--username", required=True)
        p.add_argument("--mobile", default=None)
        p.add_argument("--name", default="")

    def handle(self, username, mobile, name, **kw):
        pw = getpass.getpass("New password for %s: " % username)
        if len(pw) < 8 or pw != getpass.getpass("Type it again: "):
            raise CommandError("Passwords must match and be at least 8 characters.")
        u = User.objects.filter(username__iexact=username).first()
        if u and u.role != "ADMIN":
            raise CommandError("That username belongs to a club account.")
        created = u is None
        u = u or User(username=username.lower(), role="ADMIN")
        u.is_staff = u.is_superuser = True
        u.is_active = True
        u.first_name = name or u.first_name
        if mobile:
            u.mobile = mobile
        u.must_change_password = False
        u.set_password(pw)
        u.save()
        self.stdout.write(self.style.SUCCESS(("Created" if created else "Reset password for") + f" Super Admin '{u.username}'."))
