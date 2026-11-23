from django.contrib import admin
from django.urls import include, path

admin.site.site_header = "Shreyas Wellness World — back office"
urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include("core.urls")),
]
