"""Every error reaches the app as {"error": "plain sentence"} so it can be shown as-is."""
from django.db import IntegrityError
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler


class Rule(exceptions.APIException):
    """A business rule was broken (HTTP 400) — message is shown to the user."""
    status_code = 400
    default_detail = "That isn't allowed."


class Forbidden(exceptions.APIException):
    status_code = 403
    default_detail = "You don't have permission to do this."


def _flatten(detail):
    if isinstance(detail, list):
        return " ".join(_flatten(d) for d in detail)
    if isinstance(detail, dict):
        return " ".join(_flatten(v) for v in detail.values())
    return str(detail)


def exception_handler(exc, context):
    if isinstance(exc, IntegrityError):
        return Response({"error": "This would create a duplicate record. Refresh and try again."}, status=status.HTTP_409_CONFLICT)
    resp = drf_handler(exc, context)
    if resp is not None:
        resp.data = {"error": _flatten(resp.data.get("detail", resp.data) if isinstance(resp.data, dict) else resp.data)}
    return resp
