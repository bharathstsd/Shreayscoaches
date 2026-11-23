#!/usr/bin/env bash
# Run a Django management command with the live settings, e.g.
#   sudo ./deploy/manage.sh create_superadmin --username giri --mobile 9676011011
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$APP/backend/.env"; set +a
export LOG_DIR=""   # commands run as root log to the screen, so the app log file stays owned by www-data
cd "$APP/backend" && exec "$APP/venv/bin/python" manage.py "$@"
