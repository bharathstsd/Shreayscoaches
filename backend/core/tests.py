"""Business-rule tests from the SRS acceptance list.  Run:  python manage.py test core"""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Allocation, CouponIssue, Club, Coach, CouponUnit, Customer, PasswordResetRequest, PrintBatch, Redemption, Trial, User


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


class FlowBase(Base):
    def setUp(self):
        super().setUp()
        self.ad, self.ow, self.sp = self.as_(self.admin), self.as_(self.owner), self.as_(self.sup)
        self.b = self.batch(self.ad)
        self.alloc(self.ad, self.b["id"], self.a, 1, 50)
        self.ravi = self.customer(self.ow, "Ravi", "9848012345", self.coach)
        self.suresh = self.customer(self.ow, "Suresh", "9000022334", self.coach)

    def issue(self, client, cust, n, purpose="TRIAL"):
        return client.post("/api/issues", {"customer": cust, "unit": self.unit(self.b["code"], n), "purpose": purpose}, format="json")


class FlowTests(FlowBase):
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

    def test_one_trial_per_mobile_across_clubs(self):
        self.ow.post("/api/trials", {"customer": self.ravi}, format="json")
        owb = self.as_(self.owner_b)
        other_name = self.customer(owb, "Ravi Kumar", "9848012345", self.coach_b)    # same mobile, different spelling
        r = owb.post("/api/trials", {"customer": other_name}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("One trial per mobile", r.data["error"])
        # the same mobile can't be added twice in one club
        r = self.ow.post("/api/customers", {"name": "Ravi's wife", "mobile": "9848012345"}, format="json")
        self.assertIn("already uses mobile", r.data["error"])

    def test_visit_self_referral_and_same_club(self):
        iss = self.issue(self.ow, self.ravi, 1).data
        r = self.sp.post("/api/visits", {"issue": iss["id"], "visitor": self.ravi, "coach": self.coach.id}, format="json")
        self.assertIn("own coupon", r.data["error"])
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
        self.assertIn("from tomorrow", self.sp.post("/api/redemptions", {"visit": v["id"], "day": 2}, format="json").data["error"])
        Redemption.objects.filter(pk=r1.data["id"]).update(created_at=timezone.now() - timedelta(days=1))
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


class V2Tests(FlowBase):
    """Coupon expiry, once-ever visitors, the coupon desk, Super Admin as Owner, lists and dashboards."""

    def test_expiry_from_batch_validity(self):
        PrintBatch.objects.filter(pk=self.b["id"]).update(valid_days=10)
        iss = self.issue(self.ow, self.ravi, 1).data
        self.assertEqual(iss["expires_on"], (timezone.localdate() + timedelta(days=10)).isoformat())
        CouponIssue.objects.filter(pk=iss["id"]).update(expires_on=timezone.localdate() - timedelta(days=1))
        r = self.ow.post("/api/visits", {"issue": iss["id"], "visitor": self.suresh}, format="json")
        self.assertIn("expired", r.data["error"])
        d = self.ow.get("/api/desk?number=1").data
        self.assertEqual(d["state"], "expired")
        # validity is checked when the batch is created
        self.assertIn("between 1 and 365", self.ad.post("/api/batches", {"start": 1, "end": 5, "valid_days": 0}, format="json").data["error"])
        self.assertIn("future", self.ad.post("/api/batches", {"start": 1, "end": 5, "print_date": "2099-01-01"}, format="json").data["error"])
        self.assertIn("valid date", self.ad.post("/api/batches", {"start": 1, "end": 5, "print_date": "24/11/2026"}, format="json").data["error"])

    def test_visitor_only_once_ever_and_inline_day1(self):
        i1 = self.issue(self.ow, self.ravi, 1).data
        r = self.ow.post("/api/visits", {"issue": i1["id"], "visitor_mobile": "9701100223", "visitor_name": "Kavya", "day1": True}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data["day1"])
        i2 = self.issue(self.ow, self.suresh, 2).data
        owb = self.as_(self.owner_b)
        r = self.ow.post("/api/visits", {"issue": i2["id"], "visitor_mobile": "9701100223", "visitor_name": "Kavya"}, format="json")
        self.assertIn("only once", r.data["error"])
        r = self.ow.post("/api/visits", {"issue": i2["id"], "visitor_mobile": "9848012345", "visitor_name": "x"}, format="json")
        self.assertIn("already had a trial", r.data["error"])    # Ravi started a trial with coupon #1
        d = self.ow.get("/api/desk?number=1").data
        self.assertEqual((d["state"], d["can_d2"]), ("d1", False))
        self.assertEqual(self.ow.get("/api/desk?number=2").data["state"], "waiting")
        self.assertEqual(self.ow.get("/api/desk?number=3").data["state"], "stock")
        self.assertEqual(owb.get("/api/desk?number=3").data["state"], "other")
        self.assertEqual(self.ow.get("/api/desk?number=999").data["state"], "missing")

    def test_issue_with_new_customer_inline(self):
        r = self.ow.post("/api/issues", {"new_customer": {"name": "Meena", "mobile": "9010022334"}, "coach": self.coach.id,
                                         "unit": self.unit(self.b["code"], 5), "purpose": "TRIAL"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["customer_name"], "Meena")

    def test_trial_days_in_order_and_weekly_rules(self):
        t = self.ow.post("/api/trials", {"customer": self.ravi}, format="json").data
        self.assertIn("in order", self.ow.patch(f"/api/trials/{t['id']}", {"days": [0, 1, 0]}, format="json").data["error"])
        self.ow.patch(f"/api/trials/{t['id']}", {"days": [1, 1, 1]}, format="json")
        self.ow.post("/api/cvc", {"customer": self.ravi, "start_date": timezone.localdate().isoformat()}, format="json")
        bad = self.ow.post("/api/weekly", {"customer": self.ravi, "weight": 900}, format="json")
        self.assertIn("between", bad.data["error"])
        self.assertIn("future", self.ow.post("/api/weekly", {"customer": self.ravi, "weight": 70, "week_start": "2099-01-05"}, format="json").data["error"])
        w = self.ow.post("/api/weekly", {"customer": self.ravi, "weight": 70.5}, format="json").data
        self.assertEqual(self.ow.post(f"/api/weekly/{w['id']}/approve").status_code, 200)
        self.assertIn("already approved", self.ow.post("/api/weekly", {"customer": self.ravi, "weight": 69}, format="json").data["error"])
        self.assertIn("future", self.ow.post("/api/customers", {"name": "Baby", "mobile": "9123123123", "dob": "2099-01-01"}, format="json").data["error"])

    def test_coach_duplicates(self):
        up = {"upline_name": "U", "upline_mobile": "9848143809", "upline_herbalife_id": "W2"}
        self.assertEqual(self.ow.post("/api/coaches", {"name": "A", "mobile": "9555500001", "herbalife_id": "W77", **up}, format="json").status_code, 201)
        self.assertIn("already uses mobile", self.ow.post("/api/coaches", {"name": "B", "mobile": "9555500001", "herbalife_id": "W78", **up}, format="json").data["error"])
        self.assertIn("Herbalife ID", self.ow.post("/api/coaches", {"name": "B", "mobile": "9555500002", "herbalife_id": "w77", **up}, format="json").data["error"])

    def test_super_admin_as_owner(self):
        c = APIClient()
        self.assertEqual(c.post("/api/auth/login", {"username": "giri", "password": "Strong#Pass1", "portal": "club"}, format="json").status_code, 409)
        self.ad.patch(f"/api/clubs/{self.a.id}", {"admin_owner": self.admin.id}, format="json")
        cache.clear()
        r = c.post("/api/auth/login", {"username": "giri", "password": "Strong#Pass1", "portal": "club"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user"]["owned_clubs"][0]["id"], self.a.id)
        ad = self.as_(self.admin)          # logging in again ends the earlier session
        self.assertIn("Super Admin", ad.patch(f"/api/clubs/{self.a.id}", {"admin_owner": self.owner.id}, format="json").data["error"])

    def test_take_back_unused(self):
        self.issue(self.ow, self.ravi, 1)
        a = Allocation.objects.get(club=self.a)
        r = self.ad.post(f"/api/allocations/{a.id}/return")
        self.assertEqual(r.data["returned"], 49)
        self.assertEqual(CouponUnit.objects.filter(club=self.a, status="ALLOCATED").count(), 0)
        self.assertEqual(self.ow.post(f"/api/allocations/{a.id}/return").status_code, 403)

    def test_lists_search_and_dashboards(self):
        i1 = self.issue(self.ow, self.ravi, 1).data
        self.ow.post("/api/visits", {"issue": i1["id"], "visitor": self.suresh, "day1": True}, format="json")
        r = self.ow.get("/api/list/customers?stage=Visitor").data
        self.assertEqual([x["name"] for x in r["results"]], ["Suresh"])
        self.assertEqual(r["counts"]["In trial"], 1)
        r = self.ow.get("/api/list/referrals?status=Day 1 done").data
        self.assertEqual(r["total"], 1)
        self.assertEqual(self.ow.get("/api/list/coaches").data["results"][0]["issued"], 1)
        s = self.ow.get("/api/search?q=9848").data
        self.assertEqual(s["customers"][0]["name"], "Ravi")
        self.assertEqual(self.ow.get("/api/search?q=%231").data["referrals"][0]["number"], 1)
        self.assertEqual(self.as_(self.owner_b).get("/api/search?q=Ravi").data["counts"]["customers"], 0)
        for rng in ("today", "d7", "d30", "month", "all"):
            dsh = self.ow.get(f"/api/dash?range={rng}").data
            self.assertEqual(dsh["kpis"]["issued"], 1)
        self.assertIn("today", dsh)
        adm = self.ad.get("/api/dash?range=d30").data
        self.assertIn("attention", adm)
        self.assertEqual(sum(c["issued"] for c in adm["clubs"]), 1)
        self.assertEqual(self.sp.get("/api/dash").status_code, 403)


class V3Tests(FlowBase):
    def test_no_other_club_details_for_club_logins(self):
        i1 = self.issue(self.ow, self.ravi, 1).data
        self.ow.post("/api/visits", {"issue": i1["id"], "visitor_mobile": "9701100223", "visitor_name": "Kavya"}, format="json")
        owb = self.as_(self.owner_b)
        self.assertIsNone(owb.get("/api/desk?number=1").data["club"])
        self.alloc(self.ad, self.b["id"], self.owner_b.club, 51, 60)     # self.b is the batch here
        kav_b = self.customer(owb, "Kavya B", "9701100223", self.coach_b)
        ib = owb.post("/api/issues", {"customer": self.customer(owb, "Sita", "9000011111", self.coach_b), "unit": self.unit(self.b["code"], 51),
                                      "purpose": "TRIAL", "coach": self.coach_b.id}, format="json").data
        err = owb.post("/api/visits", {"issue": ib["id"], "visitor": kav_b}, format="json").data["error"]
        self.assertIn("another club", err)
        self.assertNotIn("Kavya", err)

    def test_new_customer_with_invitation(self):
        i1 = self.issue(self.ow, self.ravi, 1).data
        r = self.ow.post("/api/customers", {"name": "Divya", "mobile": "9550012399", "invite_number": "1", "day1": True}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertIn("Day 1 recorded", r.data["message"])
        d = self.ow.get("/api/desk?number=1").data
        self.assertEqual((d["state"], d["visitor"]), ("d1", "Divya"))
        r = self.ow.post("/api/customers", {"name": "Hari", "mobile": "9550012300", "invite_number": "1"}, format="json")
        self.assertIn("already has a visitor", r.data["error"])
        self.assertFalse(Customer.objects.filter(mobile="9550012300").exists())     # nothing half-created
        r = self.ow.post("/api/customers", {"name": "Hari", "mobile": "9550012300", "invite_number": "3"}, format="json")
        self.assertIn("hasn't been given", r.data["error"])

    def test_user_management(self):
        r = self.ad.post("/api/users", {"role": "ADMIN", "first_name": "Prasanthi", "mobile": "9885529795", "username": "prasanthi"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        pid = r.data["user"]["id"]
        self.assertTrue(r.data["password"])
        self.assertEqual(self.ad.patch(f"/api/users/{pid}", {"first_name": "Prasanthi R"}, format="json").data["name"], "Prasanthi R")
        self.assertEqual(self.ad.post(f"/api/users/{pid}/reset").status_code, 200)
        self.assertIn("own account", self.ad.post(f"/api/users/{self.admin.id}/reset").data["error"])
        self.assertIn("your own", self.ad.delete(f"/api/users/{self.admin.id}").data["error"])
        self.assertTrue(self.ad.delete(f"/api/users/{pid}").data["deactivated"])
        self.assertIn("taken", self.ad.patch(f"/api/users/{self.owner.id}", {"username": "giri"}, format="json").data["error"])
        rows = self.ad.get("/api/users").data
        self.assertTrue(any(u["role"] == "ADMIN" and not u["is_active"] for u in rows))
        self.assertEqual(self.ow.get("/api/users").status_code, 403)


class AccountTests(Base):
    def test_only_club_owner_logins_and_unique_mobile(self):
        ad = self.as_(self.admin)
        up = {"upline_name": "U", "upline_mobile": "9848143809", "upline_herbalife_id": "W2"}
        r = ad.post("/api/users", {"role": "SUPERVISOR", "club": self.b.id, "first_name": "S", "mobile": "9000000099", "herbalife_id": "HL9", **up}, format="json")
        self.assertIn("Choose Club Owner or Super Admin", r.data["error"])
        r = ad.post("/api/users", {"role": "OWNER", "club": self.a.id, "first_name": "S", "mobile": "9000000099", "herbalife_id": "HL9", **up}, format="json")
        self.assertIn("already has an active", r.data["error"])
        r = ad.post("/api/users", {"role": "OWNER", "club": self.b.id, "first_name": "S", "mobile": "9000000001", "herbalife_id": "HL9", **up}, format="json")
        self.assertIn("mobile", r.data["error"])
        r = ad.post("/api/users", {"role": "OWNER", "club": self.b.id, "first_name": "S", "mobile": "9000000099", **up}, format="json")
        self.assertIn("Herbalife", r.data["error"])

    def test_separate_logins_and_login_log(self):
        cache.clear()
        c = APIClient()
        r = c.post("/api/auth/login", {"username": "giri", "password": "Strong#Pass1", "portal": "club"}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["portal"], "admin")
        self.assertNotIn("token", r.data)
        r = c.post("/api/auth/login", {"username": self.owner.username, "password": "Strong#Pass1", "portal": "admin"}, format="json")
        self.assertEqual((r.status_code, r.data["portal"]), (409, "club"))
        r = c.post("/api/auth/login", {"username": self.owner.username, "password": "wrong", "portal": "club"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = c.post("/api/auth/login", {"username": self.owner.username, "password": "Strong#Pass1", "portal": "club"}, format="json")
        self.assertIn("token", r.data)
        ad = self.as_(self.admin)
        acts = [x["action"] for x in ad.get("/api/audit?kind=logins").data]
        self.assertIn("login", acts)
        self.assertIn("login_failed", acts)

    def test_admin_direct_reset_and_template(self):
        ad = self.as_(self.admin)
        r = ad.post(f"/api/users/{self.owner.id}/reset")
        self.assertEqual(r.status_code, 200)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.must_change_password and self.owner.check_password(r.data["password"]))
        self.assertEqual(ad.post(f"/api/users/{self.admin.id}/reset").status_code, 400)
        r = ad.get("/api/import/template")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.content[:2] == b"PK")
        self.assertEqual(self.as_(self.sup).get("/api/import/template").status_code, 403)

    def test_owner_and_coach_need_upline(self):
        ad = self.as_(self.admin)
        c = Club.objects.create(name="Club C")
        base = {"role": "OWNER", "club": c.id, "first_name": "Sumiya", "mobile": "9440809404", "herbalife_id": "W3051646"}
        r = ad.post("/api/users", base, format="json")
        self.assertIn("Upline", r.data["error"])
        r = ad.post("/api/users", {**base, "upline_name": "Santhosh", "upline_mobile": "9848143809", "upline_herbalife_id": "W2534342"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["user"]["username"], "w3051646")      # username defaults to Herbalife ID
        ow = self.as_(self.owner)
        r = ow.post("/api/coaches", {"name": "Giri", "mobile": "9676011011", "herbalife_id": "W1578045"}, format="json")
        self.assertIn("Upline", r.data["error"])
        r = ow.post("/api/coaches", {"name": "Giri", "mobile": "9676011011", "herbalife_id": "W1578045", "upline_name": "Naidu",
                                     "upline_mobile": "9000000000", "upline_herbalife_id": "W1"}, format="json")
        self.assertEqual(r.status_code, 201)

    def test_excel_upload_check_then_create(self):
        import io
        from openpyxl import Workbook
        wb = Workbook(); ws = wb.active; ws.title = "Clubs"
        ws.append(["Club name", "City", "Address", "Pincode", "Owner name", "Owner mobile", "Owner Herbalife ID",
                   "Upline / sponsor name", "Upline / sponsor mobile", "Upline / sponsor Herbalife ID"])
        ws.append(["Sumiya Club", "Kadapa", "", "", "Patnool Shaik Sumiya", "9440809404", "W3051646", "Santhosh", "9848143809", "W2534342"])
        wc = wb.create_sheet("Coaches")
        wc.append(["Club name", "Coach name", "Coach mobile", "Coach Herbalife ID", "Upline / sponsor name", "Upline / sponsor mobile", "Upline / sponsor Herbalife ID"])
        wc.append(["Club A", "Ravi", "9703416564", "W1C1327574", "Venkatramana", "9133289777", "W1C1235650"])
        buf = io.BytesIO(); wb.save(buf)
        ad = self.as_(self.admin)
        def up(commit):
            buf.seek(0)
            return ad.post("/api/import", {"file": buf, "commit": commit}, format="multipart")
        r = up("0")
        self.assertTrue(r.data["ok"]); self.assertFalse(r.data["created"])
        self.assertEqual((r.data["summary"]["new_clubs"], r.data["summary"]["coaches"]), (1, 1))
        self.assertFalse(Club.objects.filter(name="Sumiya Club").exists())
        r = up("1")
        self.assertTrue(r.data["created"]); self.assertEqual(r.data["logins"][0]["username"], "w3051646")
        self.assertEqual(Coach.objects.filter(club=self.a, name="Ravi").count(), 1)
        r = up("0")                                    # same file again: owner already exists
        self.assertFalse(r.data["ok"]); self.assertTrue(any("already" in e for e in r.data["errors"]))
        self.assertEqual(self.as_(self.owner).post("/api/import", {}, format="multipart").status_code, 403)

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
