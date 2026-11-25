"""Add sample data in two separate "Demo ·" clubs, so every screen has something to show.
Real clubs are never touched, and everything it adds can be removed again.

  python manage.py seed_sample            add the demo clubs (skipped if they already exist)
  python manage.py seed_sample --remove   delete the demo clubs and everything in them

Demo logins: demo.kadapa / demo.tirupati, password Demo@12345 (Club Owner)."""
import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from core.helpers import sync_head_coach
from core.models import (Allocation, AuditLog, Club, Coach, CouponIssue, CouponUnit, Customer, CvcMembership,
                         PasswordResetRequest, PrintBatch, Redemption, ReferralVisit, Trial, User, WeeklyResult)

PREFIX = "Demo · "
BATCH = "DEMO-01"
PASSWORD = "Demo@12345"

FIRST = ["Lakshmi", "Ravi", "Padma", "Venkat", "Anitha", "Sravani", "Kavya", "Meena", "Hari", "Suresh", "Divya", "Ramya",
         "Bhavani", "Naresh", "Sunitha", "Mahesh", "Swathi", "Kiran", "Deepa", "Prakash", "Jyothi", "Srinivas", "Madhavi",
         "Gopal", "Vani", "Raju", "Sailaja", "Anil", "Rekha", "Murali", "Usha", "Chandra", "Latha", "Ramesh", "Geetha", "Vijay"]
LAST = ["Reddy", "Naidu", "Kumar", "Rao", "Devi", "Sharma", "Babu", "Prasad", "Kumari", "Chowdary"]


class Command(BaseCommand):
    help = "Add (or --remove) sample data in separate Demo clubs. Real clubs are not touched."

    def add_arguments(self, p):
        p.add_argument("--remove", action="store_true", help="Delete the Demo clubs and everything in them.")

    def handle(self, remove, **kw):
        if remove:
            return self.remove()
        if Club.objects.filter(name__startswith=PREFIX).exists():
            self.stdout.write("Demo clubs already exist. Run with --remove first to start again.")
            return
        random.seed(7)
        self.mobiles = set(User.objects.values_list("mobile", flat=True)) | set(Customer.objects.values_list("mobile", flat=True))
        with transaction.atomic():
            admin = User.objects.filter(role="ADMIN", is_active=True).order_by("id").first()
            batch = PrintBatch.objects.create(code=BATCH, name="Demo leaflets", start_number=9001, end_number=9300,
                                              valid_days=30, color="#2F7D6D", created_by=admin)
            CouponUnit.objects.bulk_create([CouponUnit(batch=batch, number=n) for n in range(9001, 9301)])
            plan = [("Kadapa", "demo.kadapa", "Prasanthi", 9001, 9150), ("Tirupati", "demo.tirupati", "Jack", 9151, 9300)]
            for city, uname, owner_name, s, e in plan:
                self.club(admin, batch, city, uname, owner_name, s, e)
        self.stdout.write(self.style.SUCCESS(
            "Demo data added: 2 clubs (\"Demo · Kadapa\", \"Demo · Tirupati\") with coaches, customers, coupons, visits, trials, CVC and weekly results.\n"
            f"Club Owner logins: demo.kadapa / demo.tirupati, password {PASSWORD}\n"
            "Remove it all later with: seed_sample --remove"))

    # ------------------------------------------------------------------
    def mobile(self):
        while True:
            m = random.choice("6789") + "".join(random.choice("0123456789") for _ in range(9))
            if m not in self.mobiles:
                self.mobiles.add(m)
                return m

    def name(self):
        return f"{random.choice(FIRST)} {random.choice(LAST)}"

    def at(self, days_ago, hour=10):
        t = timezone.localtime() - timedelta(days=days_ago)
        return t.replace(hour=hour, minute=random.randint(0, 59), second=0, microsecond=0)

    def stamp(self, obj, when, field="created_at"):
        type(obj).objects.filter(pk=obj.pk).update(**{field: when})
        setattr(obj, field, when)

    def club(self, admin, batch, city, uname, owner_name, start, end):
        club = Club.objects.create(name=PREFIX + city, city=city, address="Main Road", pincode="516001" if city == "Kadapa" else "517501")
        self.stamp(club, self.at(50))
        owner = User(username=uname, first_name=owner_name, last_name="(demo)", role="OWNER", club=club, mobile=self.mobile(),
                     herbalife_id="DEMO" + uname[-4:].upper(), upline_name="Giri Babu M S", upline_mobile="9676011011", upline_herbalife_id="W1578045",
                     last_login=timezone.now() - timedelta(days=1))
        owner.set_password(PASSWORD)
        owner.save()
        club.owner_name, club.owner_mobile = owner.get_full_name(), owner.mobile
        club.save()
        head = sync_head_coach(club)
        coaches = [head] + [Coach.objects.create(club=club, name=self.name(), mobile=self.mobile(), herbalife_id=f"DEMOC{start % 1000 + i}",
                                                 upline_name=owner.get_full_name(), upline_mobile=owner.mobile, upline_herbalife_id=owner.herbalife_id,
                                                 created_by=admin) for i in range(3)]
        alloc = Allocation.objects.create(batch=batch, club=club, start_number=start, end_number=end, created_by=admin)
        CouponUnit.objects.filter(batch=batch, number__gte=start, number__lte=end).update(status="ALLOCATED", allocation=alloc, club=club)
        units = iter(CouponUnit.objects.filter(allocation=alloc).order_by("number"))

        def customer(days_ago, source="WALKIN", **extra):
            c = Customer.objects.create(club=club, name=self.name(), mobile=self.mobile(), coach=random.choice(coaches), source=source,
                                        created_by=owner, **extra)
            self.stamp(c, self.at(days_ago, 9))
            return c

        def issue(holder, days_ago, purpose="TRIAL", paused=False):
            u = next(units)
            u.status = "ISSUED"
            u.save(update_fields=["status"])
            when = self.at(days_ago, 11)
            i = CouponIssue.objects.create(unit=u, customer=holder, club=club, purpose=purpose, coach=holder.coach or head, created_by=owner,
                                           expires_on=when.date() + timedelta(days=batch.valid_days), is_paused=paused,
                                           pause_reason="Reported lost" if paused else "")
            self.stamp(i, when)
            return i

        def visit(i, friend, days_ago, days_done):
            v = ReferralVisit.objects.create(issue=i, visitor=friend, club=club, coach=i.coach, inviter_name=i.customer.name,
                                             inviter_mobile=i.customer.mobile, created_by=owner)
            self.stamp(v, self.at(days_ago, 12))
            for n in range(1, days_done + 1):
                r = Redemption.objects.create(visit=v, club=club, day=n, created_by=owner)
                self.stamp(r, self.at(days_ago - (n - 1), 12))
            return v

        def trial(c, days_ago, days_done):
            t = Trial.objects.create(customer=c, club=club, created_by=owner, start_date=self.at(days_ago).date())
            self.stamp(t, self.at(days_ago, 8))
            for n in range(1, days_done + 1):
                setattr(t, f"day{n}", True)
                setattr(t, f"day{n}_at", self.at(days_ago - (n - 1), 8))
            if days_done == 3:
                t.completed_at = t.day3_at
            t.save()
            return t

        def cvc(c, days_ago, weeks):
            m = CvcMembership.objects.create(customer=c, club=club, start_date=self.at(days_ago).date(), created_by=owner)
            self.stamp(m, self.at(days_ago, 9))
            w0 = round(random.uniform(68, 92), 1)
            for k in range(weeks):
                d = self.at(days_ago - 7 * k).date()
                WeeklyResult.objects.create(customer=c, club=club, week_start=d - timedelta(days=d.weekday()), weight=round(w0 - 0.6 * k, 1),
                                            waist=round(36 - 0.3 * k, 1), award_approved=(k == weeks - 1 and weeks >= 3), created_by=owner)
            return m

        # Long-time members who invite friends
        members = []
        for k in range(4):
            c = customer(45 - k, source="WALKIN")
            trial(c, 44 - k, 3)
            cvc(c, 40 - k, 5)
            members.append(c)

        # Their coupons, in every state the coupon desk shows
        friends_done = []
        for k, m in enumerate(members):
            i = issue(m, 30 - k, purpose="TRIAL" if k == 0 else "CVC")          # friend did Day 1 + Day 2, then trial, then CVC
            f = customer(28 - k, source="COUPON")
            visit(i, f, 28 - k, 2)
            friends_done.append(f)
        trial(friends_done[0], 25, 3)
        cvc(friends_done[0], 21, 3)
        trial(friends_done[1], 20, 3)                                      # completed trial -> ready for CVC
        trial(friends_done[2], 2, 2)                                       # in trial: Day 1 and 2 done, Day 3 due today
        trial(friends_done[3], 8, 1)                                       # missed (last visit 8 days ago)

        i = issue(members[0], 6, purpose="WEEKLY")
        f = customer(1, source="COUPON")
        visit(i, f, 1, 1)                                                  # Day 1 yesterday -> Day 2 due today
        i = issue(members[1], 5, purpose="WEEKLY")
        f = customer(0, source="COUPON")
        visit(i, f, 0, 1)                                                  # Day 1 today -> Day 2 tomorrow
        for k in range(3):
            issue(members[2 + (k % 2)], 3 + k, purpose="WEEKLY")           # waiting for a friend
        issue(members[3], 26, purpose="WEEKLY")                            # expires within a week
        issue(members[2], 40, purpose="WEEKLY")                            # already expired
        issue(members[1], 9, purpose="WEEKLY", paused=True)                # paused (lost)

        # Other ways in
        for k in range(2):
            ext = customer(3 + k, source="EXTERNAL", referrer_name=self.name(), source_note="Sneha Wellness World")
            v = ReferralVisit.objects.create(issue=None, visitor=ext, club=club, coach=ext.coach, inviter_name=ext.referrer_name,
                                             note=ext.source_note, created_by=owner)
            self.stamp(v, self.at(3 + k, 12))
            for n in range(1, (2 if k else 1) + 1):
                r = Redemption.objects.create(visit=v, club=club, day=n, created_by=owner)
                self.stamp(r, self.at(3 + k - (n - 1), 12))
        for k in range(3):
            c = customer(10 + k, source="OTHER", source_note=random.choice(["Instagram", "Health camp", "Pamphlet"]))
            if k == 0:
                trial(c, 2, 2)
        for k in range(4):
            c = customer(1 if k == 1 else k * 3, source="WALKIN")
            if k == 1:                                                     # trial coupon yesterday, Day 2 due today
                issue(c, 1, purpose="TRIAL")
                trial(c, 1, 1)

        AuditLog.objects.create(actor=owner, club=club, action="login", entity="user", entity_id=str(owner.pk))

    # ------------------------------------------------------------------
    def remove(self):
        clubs = list(Club.objects.filter(name__startswith=PREFIX))
        if not clubs and not PrintBatch.objects.filter(code=BATCH).exists():
            self.stdout.write("No demo data found.")
            return
        with transaction.atomic():
            for club in clubs:
                Redemption.objects.filter(club=club).delete()
                ReferralVisit.objects.filter(club=club).delete()
                WeeklyResult.objects.filter(club=club).delete()
                CvcMembership.objects.filter(club=club).delete()
                Trial.objects.filter(club=club).delete()
                CouponIssue.objects.filter(club=club).delete()
                Customer.objects.filter(club=club).delete()
                PasswordResetRequest.objects.filter(user__club=club).delete()
                AuditLog.objects.filter(club=club).delete()
                users = User.objects.filter(club=club)
                AuditLog.objects.filter(actor__in=users).delete()
                Coach.objects.filter(club=club).delete()
                users.delete()
                CouponUnit.objects.filter(club=club).update(status="FREE", club=None, allocation=None)
                Allocation.objects.filter(club=club).delete()
                club.delete()
            CouponUnit.objects.filter(batch__code=BATCH).delete()
            PrintBatch.objects.filter(code=BATCH).delete()
        self.stdout.write(self.style.SUCCESS(f"Removed {len(clubs)} demo club(s) and everything in them. Real clubs were not touched."))
