"""Data model. Key rules from the SRS are enforced here as database constraints, so they hold
even if two staff press "save" at the same moment."""
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Tracked(models.Model):
    """Who created / last changed a record, and when."""
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    created_by = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        abstract = True


class Club(models.Model):
    name = models.CharField(max_length=120, unique=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=80, blank=True, default="Andhra Pradesh")
    address = models.CharField(max_length=255, blank=True)
    pincode = models.CharField(max_length=10, blank=True)
    owner_name = models.CharField(max_length=120, blank=True)
    owner_mobile = models.CharField(max_length=15, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    # A Super Admin who also runs this club as its Owner (one login, workspace switch)
    admin_owner = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="admin_clubs")

    class Meta:
        ordering = ["-is_active", "name"]   # disabled clubs always last

    def __str__(self):
        return self.name


class User(AbstractUser):
    ADMIN, OWNER, SUPERVISOR = "ADMIN", "OWNER", "SUPERVISOR"
    ROLES = [(ADMIN, "Super Admin"), (OWNER, "Club Owner"), (SUPERVISOR, "Supervisor")]
    role = models.CharField(max_length=12, choices=ROLES, default=SUPERVISOR)
    club = models.ForeignKey(Club, null=True, blank=True, on_delete=models.PROTECT, related_name="staff")
    mobile = models.CharField(max_length=15, unique=True, null=True, blank=True)
    herbalife_id = models.CharField(max_length=40, blank=True)
    upline_name = models.CharField(max_length=120, blank=True)        # sponsor / upline
    upline_mobile = models.CharField(max_length=15, blank=True)
    upline_herbalife_id = models.CharField(max_length=40, blank=True)
    must_change_password = models.BooleanField(default=False)
    temp_password_expires = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            # one active Club Owner and one active Supervisor per club
            models.UniqueConstraint(fields=["club", "role"], condition=Q(is_active=True) & ~Q(role="ADMIN"),
                                    name="one_active_role_per_club"),
            models.CheckConstraint(condition=Q(role="ADMIN") | Q(club__isnull=False), name="staff_needs_club"),
        ]

    @property
    def is_admin(self):
        return self.role == self.ADMIN


class Coach(Tracked):
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="coaches")
    name = models.CharField(max_length=120)
    mobile = models.CharField(max_length=15, blank=True)
    herbalife_id = models.CharField(max_length=40, blank=True)
    upline_name = models.CharField(max_length=120, blank=True)        # sponsor / upline
    upline_mobile = models.CharField(max_length=15, blank=True)
    upline_herbalife_id = models.CharField(max_length=40, blank=True)
    is_active = models.BooleanField(default=True)
    # The club's Owner is its Head coach. Their coach record follows their login (name, mobile, IDs).
    user = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="coach_roles")
    is_head = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_head", "name"]


class PrintBatch(Tracked):
    code = models.CharField(max_length=20, unique=True)          # PB-0001
    name = models.CharField(max_length=80, blank=True)
    start_number = models.PositiveIntegerField()
    end_number = models.PositiveIntegerField()
    print_date = models.DateField(null=True, blank=True)
    color = models.CharField(max_length=9, default="#B48A2C")
    valid_days = models.PositiveSmallIntegerField(default=30)   # coupon validity, counted from the day it is issued

    class Meta:
        ordering = ["code"]
        constraints = [models.CheckConstraint(condition=Q(end_number__gte=models.F("start_number")), name="batch_range_ok")]

    @property
    def quantity(self):
        return self.end_number - self.start_number + 1


class Allocation(Tracked):
    batch = models.ForeignKey(PrintBatch, on_delete=models.CASCADE, related_name="allocations")
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="allocations")
    start_number = models.PositiveIntegerField()
    end_number = models.PositiveIntegerField()
    remarks = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["batch__code", "start_number"]


class CouponUnit(models.Model):
    """One physical coupon = batch + printed number."""
    FREE, ALLOCATED, ISSUED = "FREE", "ALLOCATED", "ISSUED"
    batch = models.ForeignKey(PrintBatch, on_delete=models.CASCADE, related_name="units")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=10, default=FREE, db_index=True)
    allocation = models.ForeignKey(Allocation, null=True, blank=True, on_delete=models.SET_NULL, related_name="units")
    club = models.ForeignKey(Club, null=True, blank=True, on_delete=models.PROTECT, related_name="units")

    class Meta:
        ordering = ["batch__code", "number"]
        constraints = [models.UniqueConstraint(fields=["batch", "number"], name="unique_batch_number")]

    def label(self):
        return f"{self.batch.code} #{self.number}"


class Customer(Tracked):
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="customers")
    name = models.CharField(max_length=120)
    mobile = models.CharField(max_length=10, db_index=True)
    gender = models.CharField(max_length=10, blank=True)
    dob = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    coach = models.ForeignKey(Coach, null=True, blank=True, on_delete=models.PROTECT, related_name="customers")
    is_deleted = models.BooleanField(default=False)
    SOURCES = [("WALKIN", "Walk-in"), ("COUPON", "Invitation coupon"), ("EXTERNAL", "Referred by someone not in the app"), ("OTHER", "Other")]
    source = models.CharField(max_length=10, choices=SOURCES, default="WALKIN")
    referrer_name = models.CharField(max_length=120, blank=True)     # for EXTERNAL: friend outside the app / another club
    referrer_mobile = models.CharField(max_length=15, blank=True)
    source_note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["name"]


class Trial(Tracked):
    customer = models.OneToOneField(Customer, on_delete=models.PROTECT, related_name="trial")
    club = models.ForeignKey(Club, on_delete=models.PROTECT)
    start_date = models.DateField(default=timezone.localdate)
    day1 = models.BooleanField(default=False)
    day2 = models.BooleanField(default=False)
    day3 = models.BooleanField(default=False)
    day1_at = models.DateTimeField(null=True, blank=True)
    day2_at = models.DateTimeField(null=True, blank=True)
    day3_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    @property
    def is_completed(self):
        return self.day1 and self.day2 and self.day3

    @property
    def status(self):
        if self.is_completed:
            return "COMPLETED"
        return "IN_PROGRESS" if (self.day1 or self.day2 or self.day3) else "NOT_STARTED"


class CvcMembership(Tracked):
    customer = models.OneToOneField(Customer, on_delete=models.PROTECT, related_name="cvc")
    club = models.ForeignKey(Club, on_delete=models.PROTECT)
    trial = models.ForeignKey(Trial, null=True, blank=True, on_delete=models.PROTECT)
    start_date = models.DateField()


class WeeklyResult(Tracked):
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="weekly_results")
    club = models.ForeignKey(Club, on_delete=models.PROTECT)
    week_start = models.DateField()
    weight = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    waist = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    notes = models.CharField(max_length=255, blank=True)
    award_approved = models.BooleanField(default=False)
    approved_by = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-week_start"]
        constraints = [models.UniqueConstraint(fields=["customer", "week_start"], name="one_checkup_per_week")]


class CouponIssue(Tracked):
    TRIAL, CVC, WEEKLY = "TRIAL", "CVC", "WEEKLY"
    PURPOSES = [(TRIAL, "3 Days Trial"), (CVC, "CVC Membership"), (WEEKLY, "Weekly Results")]
    unit = models.OneToOneField(CouponUnit, on_delete=models.PROTECT, related_name="issue")   # a coupon is issued once
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="issues")
    club = models.ForeignKey(Club, on_delete=models.PROTECT)
    purpose = models.CharField(max_length=10, choices=PURPOSES)
    trial = models.OneToOneField(Trial, null=True, blank=True, on_delete=models.PROTECT, related_name="coupon")
    cvc = models.OneToOneField(CvcMembership, null=True, blank=True, on_delete=models.PROTECT, related_name="coupon")
    weekly = models.OneToOneField(WeeklyResult, null=True, blank=True, on_delete=models.PROTECT, related_name="coupon")
    coach = models.ForeignKey(Coach, on_delete=models.PROTECT)
    is_paused = models.BooleanField(default=False)     # lost / stolen leaflet
    pause_reason = models.CharField(max_length=255, blank=True)
    expires_on = models.DateField(null=True, blank=True)   # last day the coupon can be used (issue date + batch validity)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_expired(self):
        return bool(self.expires_on and self.expires_on < timezone.localdate())


class ReferralVisit(Tracked):
    # One visitor per coupon. No coupon = complimentary visit for someone referred from outside the app.
    issue = models.OneToOneField(CouponIssue, null=True, blank=True, on_delete=models.PROTECT, related_name="visit")
    note = models.CharField(max_length=255, blank=True)

    @property
    def is_complimentary(self):
        return self.issue_id is None

    def coupon_label(self):
        return self.issue.unit.label() if self.issue_id else "Complimentary"
    visitor = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="visits")
    club = models.ForeignKey(Club, on_delete=models.PROTECT)
    coach = models.ForeignKey(Coach, on_delete=models.PROTECT)
    inviter_name = models.CharField(max_length=120)      # snapshots at the time of the visit
    inviter_mobile = models.CharField(max_length=10)

    class Meta:
        ordering = ["-created_at"]


class Redemption(Tracked):
    visit = models.ForeignKey(ReferralVisit, on_delete=models.PROTECT, related_name="redemptions")
    club = models.ForeignKey(Club, on_delete=models.PROTECT)
    day = models.PositiveSmallIntegerField(choices=[(1, "Day 1"), (2, "Day 2")])
    is_void = models.BooleanField(default=False)
    void_reason = models.CharField(max_length=255, blank=True)
    voided_by = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    voided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["visit", "day"], condition=Q(is_void=False), name="one_valid_redemption_per_day")]


class PasswordResetRequest(models.Model):
    PENDING, GENERATED, REJECTED, COMPLETED, EXPIRED = "PENDING", "GENERATED", "REJECTED", "COMPLETED", "EXPIRED"
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE, related_name="reset_requests")
    identifier = models.CharField(max_length=150)
    reason = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, default=PENDING)
    handled_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reject_reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    handled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class AuditLog(models.Model):
    """Append-only history. Never contains passwords, tokens or OTPs."""
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    club = models.ForeignKey(Club, null=True, blank=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=40)
    entity = models.CharField(max_length=40)
    entity_id = models.CharField(max_length=40, blank=True)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]
