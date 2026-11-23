"""Read-mostly back office for the Super Admin at /django-admin/ (the app is the main interface)."""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from . import models as m


@admin.register(m.User)
class StaffAdmin(UserAdmin):
    list_display = ("username", "first_name", "role", "club", "mobile", "is_active")
    list_filter = ("role", "club", "is_active")
    fieldsets = UserAdmin.fieldsets + (("Shreyas", {"fields": ("role", "club", "mobile", "herbalife_id", "must_change_password")}),)


for model, cols in [
    (m.Club, ("name", "city", "is_active")), (m.Coach, ("name", "club", "herbalife_id", "is_active")),
    (m.PrintBatch, ("code", "name", "start_number", "end_number")), (m.Allocation, ("batch", "club", "start_number", "end_number")),
    (m.Customer, ("name", "mobile", "club", "coach")), (m.Trial, ("customer", "club", "day1", "day2", "day3")),
    (m.CvcMembership, ("customer", "club", "start_date")), (m.CouponIssue, ("unit", "customer", "purpose", "club", "created_at")),
    (m.ReferralVisit, ("issue", "visitor", "club", "created_at")), (m.Redemption, ("visit", "day", "is_void", "created_at")),
    (m.PasswordResetRequest, ("user", "status", "created_at")),
]:
    admin.site.register(model, list_display=cols)


@admin.register(m.AuditLog)
class AuditAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "club", "action", "entity", "entity_id")
    list_filter = ("action", "entity", "club")

    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False
