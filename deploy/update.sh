#!/usr/bin/env bash
# Pull the latest code and redeploy:  sudo bash deploy/update.sh
# The new app is built beside the old one and swapped in only if the build succeeds,
# so a failed build never takes the site down.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
git pull -q --ff-only origin main
"$APP/venv/bin/pip" install -q -r backend/requirements.txt
bash deploy/manage.sh migrate --noinput
bash deploy/manage.sh collectstatic --noinput >/dev/null
cd frontend
npm ci --no-audit --no-fund --silent
npx vite build --outDir dist-new --emptyOutDir >/dev/null
rm -rf dist-old
[ -d dist ] && mv dist dist-old
mv dist-new dist
cd ..
systemctl restart shreyas-coupons
echo "Updated. Phones pick up the new version the next time the app is opened."
