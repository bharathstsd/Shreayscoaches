#!/usr/bin/env bash
# Turn on automatic deploys:  sudo bash deploy/install-autodeploy.sh
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
if ! git fetch -q origin main 2>/dev/null; then
  echo "!! This server can't read the GitHub repo without a password."
  echo "   Set up the deploy key first (see README, 'Automatic deploys'), then run this again."
  exit 1
fi
sed "s|__APP__|$APP|g" deploy/shreyas-coupons-autodeploy.service > /etc/systemd/system/shreyas-coupons-autodeploy.service
cp deploy/shreyas-coupons-autodeploy.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now shreyas-coupons-autodeploy.timer
echo "Automatic deploys are on. The server checks GitHub every 2 minutes."
echo "See what it did:  journalctl -u shreyas-coupons-autodeploy -n 50"
