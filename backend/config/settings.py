"""Shreyas Wellness World — Coupon & Referral system settings.
Everything secret or server-specific comes from environment variables (see deploy/.env.example)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def env(key, default=None):
    return os.environ.get(key, default)

SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-only-insecure-key-change-me")
DEBUG = env("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = [h.strip() for h in env("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]
SITE_HOST = env("SITE_HOST", ALLOWED_HOSTS[0] if ALLOWED_HOSTS else "localhost")
CSRF_TRUSTED_ORIGINS = [o.strip() for o in env("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"

if env("DB_ENGINE", "postgres") == "sqlite":
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "dev.sqlite3"}}
else:
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "shreyas_coupons"),
        "USER": env("POSTGRES_USER", "shreyas"),
        "PASSWORD": env("POSTGRES_PASSWORD", ""),
        "HOST": env("POSTGRES_HOST", "127.0.0.1"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }}

AUTH_USER_MODEL = "core.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-in"
TIME_ZONE = env("TIME_ZONE", "Asia/Kolkata")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["core.auth.ExpiringTokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["core.auth.Ready"],
    "DEFAULT_THROTTLE_RATES": {"login": "10/min", "reset": "20/hour"},
    "EXCEPTION_HANDLER": "core.errors.exception_handler",
}

# How long a login lasts and how long a temporary password works
TOKEN_TTL_HOURS = int(env("TOKEN_TTL_HOURS", "720"))        # 30 days
TEMP_PASSWORD_TTL_HOURS = int(env("TEMP_PASSWORD_TTL_HOURS", "24"))

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True

# App log: logins, password reset requests, Excel imports and every server error.
# Goes to the systemd journal (journalctl -u shreyas-coupons) and, when LOG_DIR is set, to LOG_DIR/app.log.
LOG_DIR = env("LOG_DIR", "")
_handlers = {"console": {"class": "logging.StreamHandler", "formatter": "plain"}}
if LOG_DIR:
    _handlers["file"] = {"class": "logging.handlers.RotatingFileHandler", "filename": os.path.join(LOG_DIR, "app.log"),
                         "maxBytes": 5 * 1024 * 1024, "backupCount": 5, "formatter": "plain", "delay": True}
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": _handlers,
    "root": {"handlers": list(_handlers), "level": "WARNING"},
    "loggers": {
        "core": {"handlers": list(_handlers), "level": "INFO", "propagate": False},
        "django.request": {"handlers": list(_handlers), "level": "ERROR", "propagate": False},
    },
}
