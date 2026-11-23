"""Fill an EMPTY database with sample clubs, staff and customers so you can try the app.
Never run this on the live database once real data exists.   python manage.py seed_demo"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Allocation, Club, Coach, CouponUnit, Customer, PrintBatch, Trial, User


class Command(BaseCommand):
    help = "Create sample data (only on an empty database)."

    @transaction.atomic
    def handle(self, **kw):
        if Club.objects.exists():
            raise CommandError("The database already has clubs. Sample data is only for an empty database.")
        admin = User.objects.filter(role="ADMIN").first()
        sww = Club.objects.create(name="Shreyas Wellness World", city="Kadapa", address="20/950, 1st Main Road, Cooperative Colony")
        shiffa = Club.objects.create(name="SHIFFA", city="Kadapa")
        Club.objects.create(name="SNEHA", city="Kadapa")
        for club, uname, first, mobile, role in [(sww, "prasanthi", "Prasanthi Reddy", "9885529795", "OWNER"),
                                                  (sww, "lakshmi", "Lakshmi", "9030045678", "SUPERVISOR"),
                                                  (shiffa, "farzana", "Farzana", "9000011111", "OWNER")]:
            u = User(username=uname, first_name=first, mobile=mobile, role=role, club=club, herbalife_id="HL-" + mobile[-5:])
            u.set_password("Demo@12345")
            u.save()
        coaches = [Coach.objects.create(club=sww, name=n, mobile=m, herbalife_id=h, created_by=admin) for n, m, h in
                   [("Prasanthi Reddy", "9885529795", "HL-21877"), ("Giri", "9676011011", "HL-20431"), ("Lakshmi", "9030045678", "HL-33190")]]
        b1 = PrintBatch.objects.create(code="PB-0001", name="Main batch", start_number=1, end_number=1000, created_by=admin)
        b2 = PrintBatch.objects.create(code="PB-0002", name="Diwali batch", start_number=1, end_number=500, color="#2F7D6D", created_by=admin)
        CouponUnit.objects.bulk_create([CouponUnit(batch=b1, number=i) for i in range(1, 1001)] + [CouponUnit(batch=b2, number=i) for i in range(1, 501)])
        for b, club, s, e in [(b1, sww, 1, 100), (b1, shiffa, 101, 200), (b2, sww, 31, 40)]:
            a = Allocation.objects.create(batch=b, club=club, start_number=s, end_number=e, created_by=admin)
            CouponUnit.objects.filter(batch=b, number__gte=s, number__lte=e).update(status="ALLOCATED", allocation=a, club=club)
        people = [("Ravi Kumar", "9848012345", 0), ("Suresh Babu", "9000022334", 1), ("Kumar Swamy", "9912244556", 0),
                  ("Lakshmi Devi", "9701066778", None), ("Anil Reddy", "9347088990", 1), ("Mahesh", "9550011223", 0)]
        custs = [Customer.objects.create(club=sww, name=n, mobile=m, coach=coaches[c] if c is not None else None, created_by=admin) for n, m, c in people]
        Trial.objects.create(customer=custs[1], club=sww, day1=True, day2=True, day3=True, created_by=admin)
        Trial.objects.create(customer=custs[2], club=sww, day1=True, day2=True, created_by=admin)
        self.stdout.write(self.style.SUCCESS("Sample data created. Club logins: prasanthi / lakshmi / farzana, password Demo@12345"))
