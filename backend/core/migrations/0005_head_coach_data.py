"""Data for v3: clubs always enabled, each Owner becomes the club's Head coach, sources and trial-day dates."""
from django.db import migrations


def forwards(apps, schema_editor):
    Club = apps.get_model("core", "Club")
    User = apps.get_model("core", "User")
    Coach = apps.get_model("core", "Coach")
    Customer = apps.get_model("core", "Customer")
    Trial = apps.get_model("core", "Trial")
    ReferralVisit = apps.get_model("core", "ReferralVisit")
    Club.objects.update(is_active=True)                      # clubs can no longer be disabled
    for club in Club.objects.all():
        owner = User.objects.filter(club=club, role="OWNER", is_active=True).first() or (
            User.objects.filter(pk=club.admin_owner_id, is_active=True).first() if club.admin_owner_id else None)
        if not owner:
            continue
        name = (owner.first_name + " " + owner.last_name).strip() or owner.username
        coach = Coach.objects.filter(club=club, mobile=owner.mobile).first() if owner.mobile else None   # already added by hand
        if not coach:
            coach = Coach(club=club)
        coach.user, coach.is_head, coach.is_active, coach.name = owner, True, True, name
        coach.mobile = owner.mobile or coach.mobile
        coach.herbalife_id = owner.herbalife_id or coach.herbalife_id
        for f in ("upline_name", "upline_mobile", "upline_herbalife_id"):
            setattr(coach, f, getattr(owner, f) or getattr(coach, f))
        coach.save()
    visitor_ids = ReferralVisit.objects.values_list("visitor_id", flat=True)
    Customer.objects.filter(pk__in=visitor_ids).update(source="COUPON")
    for t in Trial.objects.all():
        for n in (1, 2, 3):
            if getattr(t, f"day{n}") and not getattr(t, f"day{n}_at"):
                setattr(t, f"day{n}_at", t.updated_at if hasattr(t, "updated_at") else t.created_at)
        t.save()


class Migration(migrations.Migration):
    dependencies = [("core", "0004_head_coach_sources_trial_dates")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
