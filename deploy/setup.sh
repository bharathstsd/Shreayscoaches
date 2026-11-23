#!/usr/bin/env bash
# One-time install on the VPS (Ubuntu/Debian). Run from the cloned repo as root:
#   sudo bash deploy/setup.sh app.shreyaswellnessworld.com
set -euo pipefail
DOMAIN="${1:?Usage: sudo bash deploy/setup.sh <domain>}"
APP="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Installing into $APP for https://$DOMAIN"

apt-get update -qq
apt-get install -y -qq postgresql python3-venv python3-pip nginx certbot python3-certbot-nginx curl >/dev/null
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

echo "==> Database"
ENV_FILE="$APP/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  DBPASS=$(python3 -c "import secrets;print(secrets.token_urlsafe(24))")
  SECRET=$(python3 -c "import secrets;print(secrets.token_urlsafe(50))")
  sed -e "s|DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$SECRET|" -e "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$DBPASS|" \
      -e "s|ALLOWED_HOSTS=.*|ALLOWED_HOSTS=$DOMAIN|" -e "s|CSRF_TRUSTED_ORIGINS=.*|CSRF_TRUSTED_ORIGINS=https://$DOMAIN|" \
      "$APP/deploy/env.example" > "$ENV_FILE"
  chmod 640 "$ENV_FILE"; chown root:www-data "$ENV_FILE"
  sudo -u postgres psql -qc "CREATE USER shreyas WITH PASSWORD '$DBPASS';" 2>/dev/null || sudo -u postgres psql -qc "ALTER USER shreyas WITH PASSWORD '$DBPASS';"
  sudo -u postgres psql -qc "CREATE DATABASE shreyas_coupons OWNER shreyas;" 2>/dev/null || true
else
  echo "    backend/.env already exists, keeping it"
fi

echo "==> Python packages"
[ -d "$APP/venv" ] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$APP/backend/requirements.txt"
bash "$APP/deploy/manage.sh" migrate --noinput
bash "$APP/deploy/manage.sh" collectstatic --noinput >/dev/null

echo "==> Building the app"
cd "$APP/frontend" && npm ci --no-audit --no-fund --silent && npm run build --silent && cd "$APP"

echo "==> Service + web server"
sed "s|__APP__|$APP|g" "$APP/deploy/shreyas-coupons.service" > /etc/systemd/system/shreyas-coupons.service
systemctl daemon-reload
systemctl enable --now shreyas-coupons
sed -e "s|__APP__|$APP|g" -e "s|__DOMAIN__|$DOMAIN|g" "$APP/deploy/nginx.conf" > /etc/nginx/sites-available/shreyas-coupons
ln -sf /etc/nginx/sites-available/shreyas-coupons /etc/nginx/sites-enabled/shreyas-coupons
nginx -t && systemctl reload nginx

echo "==> HTTPS certificate"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || \
  echo "!! Certificate failed. Check that $DOMAIN points to this server, then run: certbot --nginx -d $DOMAIN"

echo
echo "Done. Next: create your Super Admin login:"
echo "  sudo bash $APP/deploy/manage.sh create_superadmin --username giri --mobile 9676011011 --name Giri"
echo "Then open https://$DOMAIN"
