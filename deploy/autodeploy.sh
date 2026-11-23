#!/usr/bin/env bash
# Called every 2 minutes by the shreyas-coupons-autodeploy timer.
# If GitHub's main branch has new commits, pull them and redeploy.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
exec 9>/run/shreyas-coupons-autodeploy.lock
flock -n 9 || exit 0                     # a deploy is already running
cd "$APP"
git fetch -q origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0
echo "New code on GitHub: ${LOCAL:0:7} -> ${REMOTE:0:7}. Deploying..."
bash "$APP/deploy/update.sh"
echo "Deployed $(git log -1 --format='%h %s')"
