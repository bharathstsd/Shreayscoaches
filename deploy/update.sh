#!/usr/bin/env bash
# Pull the latest code and redeploy:  sudo bash deploy/update.sh
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
git pull --ff-only
"$APP/venv/bin/pip" install -q -r backend/requirements.txt
bash deploy/manage.sh migrate --noinput
bash deploy/manage.sh collectstatic --noinput >/dev/null
cd frontend && npm ci --no-audit --no-fund --silent && npm run build --silent && cd ..
systemctl restart shreyas-coupons
echo "Updated. Phones pick up the new version the next time the app is opened."
