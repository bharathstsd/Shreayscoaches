from django.urls import path

from . import views as v

urlpatterns = [
    path("auth/login", v.login), path("auth/logout", v.logout), path("auth/me", v.me),
    path("auth/change-password", v.change_password), path("auth/forgot", v.forgot_password),
    path("resets", v.reset_list), path("resets/<int:pk>/generate", v.reset_generate), path("resets/<int:pk>/reject", v.reset_reject),
    path("clubs", v.clubs), path("clubs/<int:pk>", v.club_detail), path("clubs/<int:pk>/toggle", v.club_toggle),
    path("users", v.users), path("users/<int:pk>", v.user_detail),
    path("coaches", v.coaches), path("coaches/<int:pk>", v.coach_detail),
    path("batches", v.batches), path("batches/<int:pk>", v.batch_detail),
    path("allocations", v.allocations), path("stock", v.stock), path("stock/find", v.stock_find),
    path("customers", v.customers), path("customers/<int:pk>", v.customer_detail),
    path("trials", v.trials), path("trials/<int:pk>", v.trial_detail),
    path("cvc", v.cvc), path("weekly", v.weekly), path("weekly/<int:pk>/approve", v.weekly_approve),
    path("issues", v.issues), path("issues/<int:pk>", v.issue_detail),
    path("visits", v.visits), path("redemptions", v.redemptions), path("redemptions/<int:pk>/void", v.redemption_void),
    path("dashboard", v.dashboard), path("referral-tree", v.referral_tree), path("export.csv", v.export_csv),
    path("audit", v.audit_log), path("import", v.import_excel), path("import/template", v.import_template),
    path("users/<int:pk>/reset", v.user_reset),
]
