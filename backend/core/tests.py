"""Business-rule tests from the SRS acceptance list.  Run:  python manage.py test core"""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Club, Coach, CouponUnit, Customer, PasswordResetRequest, PrintBatch, Redemption, Trial, User


class Base(TestCase):
    def setUp(self):
        self.admin = self.mk("giri", "ADMIN", None, "9676011011")
        self.a = Club.objects.create(name="Club A", city="Kadapa")
        self.b = Club.objects.create(name="Club B", city="Kadapa")
        self.owner = self.mk("owner", "OWNER", self.a, "9000000001")
        self.sup = self.mk("sup", "SUPERVISOR", self.a, "9000000002")
        self.owner_b = self.mk("ownerb", "OWNER", self.b, "9000000003")
        self.coach = Coach.objects.create(club=self.a, name="Prasanthi", mobile="9885529795")
        self.coach_b = Coach.objects.create(club=self.b, name="Farzana", mobile="9885529000")

    def mk(self, username, role, club, mobile):
        u = User(username=username, role=role, club=club, mobile=mobile, herbalife_id="HL-1")
        u.set_password("Strong#Pass1")
        u.save()
        return u

    def as_(self, user):
        cache.clear()       # login is rate-limited; tests log in many times
        c = APIClient()
        r = c.post("/api/auth/login", {"username": user.username, "password": "Strong#Pass1"}, format="json")
        assert r.status_code == 200, r.content
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["token"])
        return c

    def batch(self, admin_c, start=1, end=100):
        return admin_c.post("/api/batches", {"start": start, "end": end, "name": "Test"}, format="json").data

    def alloc(self, admin_c, batch_id, club, s, e):
        return admin_c.post("/api/allocations", {"batch": batch_id, "club": club.id, "start": s, "end": e}, format="json")

    def customer(self, c, name, mobile, coach=None):
        r = c.post("/api/customers", {"name": name, "mobile": mobile, "coach": coach.id if coach else None}, format="json")
        assert r.status_code == 201, r.content
        return r.data["id"]

    def unit(self, batch_code, n):
        return CouponUnit.objects.get(batch__code=batch_code, number=n).id


class InventoryTests(Base):
    def test_same_number_in_two_batches_allowed_and_allocation_overlap_rejected(self):
        ad = self.as_(self.admin)
        b1, b2 = self.batch(ad), self.batch(ad)
        self.assertEqual(CouponUnit.objects.filter(number=5).count(), 2)
        self.assertEqual(self.alloc(ad, b1["id"], self.a, 1, 50).status_code, 201)
        r = self.alloc(ad, b1["id"], self.b, 40, 60)
        self.assertEqual(r.status_code, 400)
        self.assertIn("already belong", r.data["error"])
        self.assertEqual(self.alloc(ad, b2["id"], self.b, 1, 50).status_code, 201)

    def test_only_admin_allocates_and_disabled_club_cannot_receive(self):
        ad, ow = self.as_(self.admin), self.as_(self.owner)
        b = self.batch(ad)
        self.assertEqual(self.alloc(ow, b["id"], self.a, 1, 5).status_code, 403)
        ad.post(f"/api/clubs/{self.b.id}/toggle")
        self.assertEqual(self.alloc(ad, b["id"], self.b, 1, 5).status_code, 400)

    def test_batch_delete_blocked_once_issued(self):
        ad, ow = self.as_(self.admin), self.as_(self.owner)
        b = self.batch(ad)
        self.alloc(ad, b["id"], self.a, 1, 10)
        cid = self.customer(ow, "Ravi", "9848012345", self.coach)
        self.assertEqual(ow.post("/api/issues", {"customer": cid, "unit": self.unit(b["code"], 3), "purpose": "TRIAL"}, format="json").status_code, 201)
        r = ad.delete(f"/api/batches/{b['id']}")
        self.assertEqual(r.status_code, 400)
        b2 = self.batch(ad)
        self.alloc(ad, b2["id"], self.a, 1, 10)
        self.assertEqual(ad.delete(f"/api/batches/{b2['id']}").status_code, 200)
        self.assertFalse(PrintBatch.objects.filter(pk=b2["id"]).exists())
        self.assertFalse(CouponUnit.objects.filter(batch_id=b2["id"]).exists())


class FlowTests(Base):
    def setUp(self):
        super().setUp()
        self.ad, self.ow, self.sp = self.as_(self.admin), self.as_(self.owner), self.as_(self.sup)
        self.b = self.batch(self.ad)
        self.alloc(self.ad, self.b["id"], self.a, 1, 50)
        self.ravi = self.customer(self.ow, "Ravi", "9848012345", self.coach)
        self.suresh = self.customer(self.ow, "Suresh", "9000022334", self.coach)

    def issue(self, client, cust, n, purpose="TRIAL"):
        return client.post("/api/issues", {"customer": cust, "unit": self.unit(self.b["code"], n), "purpose": purpose}, format="json")

    def test_coupon_cannot_be_issued_twice_or_from_other_club(self):
        self.assertEqual(self.issue(self.ow, self.ravi, 1).status_code, 201)
        r = self.issue(self.ow, self.suresh, 1)
        self.assertEqual(r.status_code, 400)
        owb = self.as_(self.owner_b)
        cb = self.customer(owb, "Farah", "9111111111", self.coach_b)
        self.assertEqual(self.issue(owb, cb, 2).status_code, 400)       # unit belongs to Club A

    def test_purpose_lifecycle(self):
        r = self.issue(self.ow, self.ravi, 1, "CVC")
        self.assertIn("completed 3-day trial", r.data["error"])
        self.assertEqual(self.issue(self.ow, self.ravi, 1, "TRIAL").status_code, 201)   # starts the trial too
        self.assertIn("already given", self.issue(self.ow, self.ravi, 2, "TRIAL").data["error"])
        t = Trial.objects.get(customer_id=self.ravi)
        self.ow.patch(f"/api/trials/{t.id}", {"days": [1, 1, 1]}, format="json")
        self.assertIn("Convert", self.issue(self.ow, self.ravi, 2, "CVC").data["error"])
        r = self.ow.post("/api/cvc", {"customer": self.ravi, "start_date": timezone.localdate().isoformat()}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.issue(self.ow, self.ravi, 2, "CVC").status_code, 201)
        self.assertIn("approved Best Results", self.issue(self.ow, self.ravi, 3, "WEEKLY").data["error"])

    def test_cvc_needs_completed_trial_and_date_window(self):
        r = self.ow.post("/api/cvc", {"customer": self.ravi, "start_date": timezone.localdate().isoformat()}, format="json")
        self.assertEqual(r.status_code, 400)
        t = self.ow.post("/api/trials", {"customer": self.ravi}, format="json").data
        self.ow.patch(f"/api/trials/{t['id']}", {"days": [1, 1, 1]}, format="json")
        old = (timezone.localdate() - timedelta(days=8)).isoformat()
        future = (timezone.localdate() + timedelta(days=1)).isoformat()
        self.assertIn("7 days", self.ow.post("/api/cvc", {"customer": self.ravi, "start_date": old}, format="json").data["error"])
        self.assertIn("future", self.ow.post("/api/cvc", {"customer": self.ravi, "start_date": future}, format="json").data["error"])

    def test_one_trial_per_person_across_clubs(self):
        self.ow.post("/api/trials", {"customer": self.ravi}, format="json")
        owb = self.as_(self.owner_b)
        same = self.customer(owb, "ravi", "9848012345", self.coach_b)
        r = owb.post("/api/trials", {"customer": same}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("another club", r.data["error"])
        family = self.customer(owb, "Ravi's wife", "9848012345", self.coach_b)   # shared family number is fine
        self.assertEqual(owb.post("/api/trials", {"customer": family}, format="json").status_code, 201)

    def test_visit_self_referral_and_same_club(self):
        iss = self.issue(self.ow, self.ravi, 1).data
        r = self.sp.post("/api/visits", {"issue": iss["id"], "visitor": self.ravi, "coach": self.coach.id}, format="json")
        self.assertIn("refer themselves", r.data["error"])
        owb = self.as_(self.owner_b)
        vb = self.customer(owb, "Farah", "9111111111", self.coach_b)
        r = owb.post("/api/visits", {"issue": iss["id"], "visitor": vb, "coach": self.coach_b.id}, format="json")
        self.assertIn("issuing club", r.data["error"] + "issuing club")   # rejected
        self.assertEqual(r.status_code, 400)
        ok = self.sp.post("/api/visits", {"issue": iss["id"], "visitor": self.suresh, "coach": self.coach.id}, format="json")
        self.assertEqual(ok.status_code, 201)
        again = self.sp.post("/api/visits", {"issue": iss["id"], "visitor": self.suresh, "coach": self.coach.id}, format="json")
        self.assertIn("already has a visitor", again.data["error"])

    def test_redemption_order_duplicates_and_void(self):
        iss = self.issue(self.ow, self.ravi, 1).data
        v = self.sp.post("/api/visits", {"issue": iss["id"], "visitor": self.suresh, "coach": self.coach.id}, format="json").data
        self.assertIn("Day 1 must", self.sp.post("/api/redemptions", {"visit": v["id"], "day": 2}, format="json").data["error"])
        r1 = self.sp.post("/api/redemptions", {"visit": v["id"], "day": 1}, format="json")
        self.assertEqual(r1.status_code, 201)
        self.assertIn("already been redeemed", self.sp.post("/api/redemptions", {"visit": v["id"], "day": 1}, format="json").data["error"])
        r2 = self.sp.post("/api/redemptions", {"visit": v["id"], "day": 2}, format="json")
        self.assertEqual(r2.status_code, 201)
        # void Day 1 while Day 2 valid -> blocked; nothing is ever deleted
        self.assertIn("Day 2 entry first", self.sp.post(f"/api/redemptions/{r1.data['id']}/void", {"reason": "typo"}, format="json").data["error"])
        self.assertEqual(self.sp.post(f"/api/redemptions/{r2.data['id']}/void", {"reason": "wrong person"}, format="json").status_code, 200)
        self.assertEqual(Redemption.objects.count(), 2)
        pending = self.ow.get("/api/visits?pending=1").data
        self.assertEqual(len(pending), 1)

    def test_role_edit_rules(self):
        cid = self.customer(self.sp, "Kumar", "9912244556", self.coach)
        t = self.sp.post("/api/trials", {"customer": cid}, format="json").data
        t2 = self.ow.post("/api/trials", {"customer": self.ravi}, format="json").data
        self.assertEqual(self.ow.patch(f"/api/trials/{t['id']}", {"days": [1, 0, 0]}, format="json").status_code, 200)   # owner edits supervisor's
        self.assertEqual(self.sp.patch(f"/api/trials/{t2['id']}", {"days": [1, 0, 0]}, format="json").status_code, 403)  # supervisor can't edit owner's
        self.assertEqual(self.sp.patch(f"/api/trials/{t['id']}", {"days": [1, 1, 0]}, format="json").status_code, 200)

    def test_club_isolation_and_supervisor_no_dashboard(self):
        owb = self.as_(self.owner_b)
        self.assertEqual(owb.get("/api/customers").data, [])
        self.assertEqual(owb.get(f"/api/customers/{self.ravi}").status_code, 400)
        self.assertEqual(self.sp.get("/api/dashboard").status_code, 403)
        self.assertEqual(self.sp.get("/api/referral-tree").status_code, 403)
        self.assertEqual(self.ow.get("/api/dashboard").status_code, 200)
        self.assertNotIn("clubs", self.ow.get("/api/dashboard").data)
        self.assertIn("clubs", self.ad.get("/api/dashboard").data)

    def test_disabled_club_blocks_login_and_writes(self):
        self.ad.post(f"/api/clubs/{self.a.id}/toggle")
        self.assertEqual(APIClient().post("/api/auth/login", {"username": "owner", "password": "Strong#Pass1"}, format="json").status_code, 403)
        r = self.ad.post("/api/customers", {"club": self.a.id, "name": "X", "mobile": "9999999999"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_referral_tree_generations(self):
        kumar = self.customer(self.ow, "Kumar", "9912244556", self.coach)
        i1 = self.issue(self.ow, self.ravi, 1).data
        self.sp.post("/api/visits", {"issue": i1["id"], "visitor": self.suresh, "coach": self.coach.id}, format="json")
        i2 = self.issue(self.ow, self.suresh, 2).data
        self.sp.post("/api/visits", {"issue": i2["id"], "visitor": kumar, "coach": self.coach.id}, format="json")
        tree = self.ow.get("/api/referral-tree").data
        self.assertEqual(tree[0]["root"], "Ravi")
        self.assertEqual(tree[0]["size"], 2)
        self.assertEqual(tree[0]["generations"], {1: 1, 2: 1})


class AccountTests(Base):
    def test_one_supervisor_per_club_and_unique_mobile(self):
        ad = self.as_(self.admin)
        r = ad.post("/api/users", {"role": "SUPERVISOR", "club": self.a.id, "username": "sup2", "first_name": "S", "mobile": "9000000099", "herbalife_id": "HL"}, format="json")
        self.assertIn("already has an active", r.data["error"])
        r = ad.post("/api/users", {"role": "SUPERVISOR", "club": self.b.id, "username": "sup2", "first_name": "S", "mobile": "9000000001", "herbalife_id": "HL"}, format="json")
        self.assertIn("mobile", r.data["error"])
        r = ad.post("/api/users", {"role": "SUPERVISOR", "club": self.b.id, "username": "sup2", "first_name": "S", "mobile": "9000000099"}, format="json")
        self.assertIn("Herbalife", r.data["error"])

    def test_password_reset_flow(self):
        c = APIClient()
        self.assertEqual(c.post("/api/auth/forgot", {"username": "nobody"}, format="json").status_code, 200)
        c.post("/api/auth/forgot", {"username": "sup", "reason": "forgot"}, format="json")
        req = PasswordResetRequest.objects.get(user=self.sup)
        ad = self.as_(self.admin)
        g = ad.post(f"/api/resets/{req.id}/generate").data
        self.assertIn("Temporary Password", g["message"])
        r = c.post("/api/auth/login", {"username": "sup", "password": g["password"]}, format="json")
        tok = r.data["token"]
        self.assertTrue(r.data["user"]["must_change_password"])
        c.credentials(HTTP_AUTHORIZATION="Bearer " + tok)
        self.assertEqual(c.get("/api/customers").status_code, 403)     # must change first
        self.assertEqual(c.post("/api/auth/change-password", {"current": g["password"], "new": "Brand#New99", "confirm": "Brand#New99"}, format="json").status_code, 200)
        self.assertEqual(c.get("/api/customers").status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, "COMPLETED")
        from .models import AuditLog
        self.assertFalse(any(g["password"] in str(a.after) + str(a.before) for a in AuditLog.objects.all()))
