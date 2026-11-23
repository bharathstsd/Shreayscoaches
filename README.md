# Shreyas Wellness World — Coupon & Referral System

A web app and installable phone app (PWA) that tracks physical referral coupons across your Nutrition Clubs, from the printed batch to the friend's Day 1 and Day 2 visits, 3-day trial and CVC membership.

| Part | Technology |
|---|---|
| Database | PostgreSQL |
| API | Python 3.10+, Django 5.1, Django REST Framework |
| App | React 18 + Vite, installable PWA |
| Server | nginx + gunicorn (systemd), Let's Encrypt HTTPS |

```
backend/    Django API (all business rules live in core/views.py, data model in core/models.py)
frontend/   React PWA (screens in src/screens/)
deploy/     setup.sh, update.sh, manage.sh, nginx and systemd templates
```

## Go live on your VPS (first time, about 15 minutes)

1. **DNS.** At your domain provider, add an **A record**: `app` → your server's IP address (the same IP as www.shreyaswellnessworld.com). Wait until `ping app.shreyaswellnessworld.com` shows that IP.
2. **Get the code onto the server** (as root):
   ```bash
   cd /var/www
   git clone <your-repo-url> shreyas-coupons
   cd shreyas-coupons
   ```
3. **Install everything:**
   ```bash
   sudo bash deploy/setup.sh app.shreyaswellnessworld.com
   ```
   This installs PostgreSQL, Python and Node packages, creates the database with a random password, builds the app, starts the service, sets up nginx and gets the HTTPS certificate. Your existing website is not touched.
4. **Create your Super Admin login:**
   ```bash
   sudo bash deploy/manage.sh create_superadmin --username giri --mobile 9676011011 --name Giri
   ```
5. Open **https://app.shreyaswellnessworld.com**, log in, then: add clubs, create each club's Owner and Supervisor logins, add a print batch and allocate ranges to clubs.

On a phone, open the address in Chrome (Android) or Safari (iPhone) and choose **Add to Home Screen** to install it like an app.

## Updating later

```bash
cd /var/www/shreyas-coupons && sudo bash deploy/update.sh
```

## Automatic deploys

Once this is set up, anything pushed to the `main` branch on GitHub goes live within about 2 minutes. The server checks GitHub itself, so no server passwords or keys are stored on GitHub.

**One-time setup on the server (as root):**

1. Create a read-only key for the server and print it:
   ```bash
   ssh-keygen -t ed25519 -f /root/.ssh/shreyas_coaches -N "" -C "coupon server"
   cat >> /root/.ssh/config <<'CFG'
   Host github-coaches
     HostName github.com
     User git
     IdentityFile /root/.ssh/shreyas_coaches
     IdentitiesOnly yes
   CFG
   cat /root/.ssh/shreyas_coaches.pub
   ```
2. On GitHub, open the repo → **Settings → Deploy keys → Add deploy key**. Paste the line that was printed, name it "coupon server", leave **Allow write access** unticked, and save.
3. Point the server's copy at that key, fetch the latest code and turn auto-deploy on:
   ```bash
   cd /var/www/shreyas-coupons
   git remote set-url origin git@github-coaches:bharathstsd/Shreayscoaches.git
   ssh -o StrictHostKeyChecking=accept-new -T github-coaches; git pull
   sudo bash deploy/install-autodeploy.sh
   ```

**Check what it did:** `journalctl -u shreyas-coupons-autodeploy -n 50`
**Pause it:** `systemctl stop shreyas-coupons-autodeploy.timer` (start it again with `start`).

If a build fails, the previous version stays live and the error shows in that log.

## Adding clubs and logins in bulk from Excel

1. Fill in `deploy/club-import-template.xlsx` (sheet **Clubs**: club details plus its Owner and Supervisor; optional sheet **Coaches**).
2. Upload it to the server, e.g. as `/root/clubs.xlsx`.
3. Check it (changes nothing): `sudo bash deploy/manage.sh import_clubs /root/clubs.xlsx`
4. Create everything: `sudo bash deploy/manage.sh import_clubs /root/clubs.xlsx --commit`

Step 4 writes `/root/logins-<date>.csv` with each person's username, temporary password (valid 72 hours) and a ready WhatsApp message. Send the messages, then delete that file. Clubs that already exist are reused; existing usernames or mobiles are reported, and nothing is created until every row is correct.

## Useful commands

| What | Command |
|---|---|
| See if the API is running | `systemctl status shreyas-coupons` |
| API error log | `journalctl -u shreyas-coupons -n 100` |
| Reset the Super Admin password | `sudo bash deploy/manage.sh create_superadmin --username giri` |
| Back office (read-only tables) | `https://app.shreyaswellnessworld.com/django-admin/` |
| Try with sample data (empty database only) | `sudo bash deploy/manage.sh seed_demo` |

## Rules the server enforces

- A coupon is batch + number; the same number can exist in different batches. A coupon belongs to one club and is issued once.
- Coupon purposes in order: 3-day trial (issuing it starts the trial), then CVC (needs a completed trial and a CVC membership), then Weekly Results (needs an approved Best Results award). Each qualification gives one coupon.
- One 3-day trial per person across all clubs. Same mobile **and** same name counts as the same person, so family members sharing a number can each take one.
- CVC: all 3 trial days attended; start date today or within the last 7 days.
- A friend must visit the club that issued the coupon; nobody can use their own coupon; one visitor per coupon.
- Day 1 then Day 2, each once. Redemptions are never deleted; a mistake is corrected with a reason and stays in history.
- Super Admin sees everything. Club Owners see only their club and can change their own and their Supervisor's entries. Supervisors only enter data and change only their own entries; no dashboards.
- One active Club Owner and one active Supervisor per club. Usernames and mobiles are unique; Herbalife ID is required.
- Disabled clubs: staff can't log in and nothing new can be entered; history stays visible to the Super Admin.
- Every change is written to the change log; passwords and tokens never are.

## Development

```bash
# API (uses a local PostgreSQL; set POSTGRES_* env vars, or DB_ENGINE=sqlite for a quick try)
cd backend && pip install -r requirements.txt && python manage.py migrate && python manage.py runserver
python manage.py test core          # business-rule tests

# App (proxies /api to localhost:8000)
cd frontend && npm install && npm run dev
```
