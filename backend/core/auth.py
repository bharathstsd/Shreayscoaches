"""Login tokens that expire, and blocking of disabled clubs / unchanged temporary passwords."""
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import exceptions, permissions
from rest_framework.authentication import TokenAuthentication


class ExpiringTokenAuthentication(TokenAuthentication):
    keyword = "Bearer"

    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        if token.created < timezone.now() - timedelta(hours=settings.TOKEN_TTL_HOURS):
            token.delete()
            raise exceptions.AuthenticationFailed("Your session has expired. Please log in again.")
        if not user.is_admin and user.club and not user.club.is_active:
            raise exceptions.AuthenticationFailed("Your club is disabled. Please contact the Super Admin.")
        return user, token


class Ready(permissions.BasePermission):
    """Logged in, and not still on a temporary password."""
    message = "Please set a new password before continuing."

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and not u.must_change_password)


class AdminOnly(Ready):
    message = "Only the Super Admin can do this."

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_admin


class NotSupervisor(Ready):
    message = "Dashboards and reports are for the Club Owner and Super Admin."

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.role != "SUPERVISOR"
