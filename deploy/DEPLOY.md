# Deploying to cPanel shared hosting (Node + MySQL)

Assumes: SSH/Terminal access, Node installed through NVM (Node 18+), and **no sudo**.
The React build is created **locally** (shared servers usually run out of memory building React).

## 1. Database (cPanel → MySQL® Databases)
1. Create a database and a user, add the user to the database with ALL PRIVILEGES.
2. cPanel prefixes both, e.g. `cpuser_billing` (db) and `cpuser_billinguser` (user). **Use these full prefixed names.**
3. Never use `root`, and use host **`127.0.0.1`** (not `localhost`; IPv6 resolution can refuse the connection).

## 2. Get the code onto the server
```bash
cd ~
git clone https://github.com/<you>/<repo>.git billing-app        # private repo: use a deploy key / token
cd billing-app/backend
source ~/.nvm/nvm.sh && nvm use 18
npm ci --omit=dev
cp .env.example .env && nano .env      # fill DB_*, JWT_SECRET, CORS_ORIGINS, ADMIN_*, SMTP_* (optional)
```
Generate a strong secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## 3. Create tables + first admin
```bash
npm run migrate
npm run seed          # company, GST rates, default settings, and the admin from ADMIN_EMAIL / ADMIN_PASSWORD
```
Sign in and change the password immediately (top bar → Password).

## 4. Run the API with PM2 (no sudo)
```bash
npm i -g pm2
pm2 start server.js --name billing-backend
pm2 save
```
Add cron jobs (cPanel → Cron Jobs) so it survives reboots/crashes:
```
@reboot     bash $HOME/billing-app/deploy/start_backend.sh >/dev/null 2>&1
*/5 * * * * bash $HOME/billing-app/deploy/start_backend.sh >/dev/null 2>&1
30 2 * * *  BACKUP_DIR=$HOME/billing-app/backend/backups bash $HOME/billing-app/deploy/backup.sh
```
The last one is the daily MySQL backup; Settings → Backup & Audit shows the latest one.
After editing `.env`: `pm2 restart billing-backend --update-env`

## 5. Frontend (build locally, upload the result)
```bash
cd frontend
npm ci
npm run build           # uses VITE_API_URL from .env.production (default "/api" = same domain)
```
Upload the **contents** of `frontend/dist/` (including the hidden `.htaccess`) to `public_html/` (or the sub-domain's document root) via cPanel File Manager or FTP.

## 6. Make `/api` reach the Node process
The browser calls `https://YOUR-DOMAIN/api/...`, which must reach the Node port (default 5000). Use whichever your host allows:
* **The same route you already use for other Node apps on this host** (recommended), or
* **cPanel → Setup Node.js App** (Passenger): app root `billing-app/backend`, startup file `server.js`, set the env vars there, and `SERVE_FRONTEND=true` so one app serves both UI and `/api` (then step 5's upload is not needed), or
* Put the API on its own sub-domain and build the frontend with `VITE_API_URL=https://api.yourdomain.com/api`; add the frontend origin to `CORS_ORIGINS`.

Enable AutoSSL (Let's Encrypt) in cPanel and force HTTPS.

## 7. Verify
* `https://YOUR-DOMAIN/api/health` → `{"success":true,"status":"ok"}`
* Log in → Settings → Company: set **State** (drives CGST/SGST vs IGST), GSTIN, bank details, logo.

## Updating later
```bash
cd ~/billing-app && git pull
cd backend && source ~/.nvm/nvm.sh && npm ci --omit=dev && npm run migrate && pm2 restart billing-backend --update-env
# frontend changed? rebuild locally and re-upload dist/
```

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `ECONNREFUSED` to MySQL | use `DB_HOST=127.0.0.1`, not `localhost` |
| `Access denied` | use the cPanel-prefixed user **and** database name; root is blocked |
| API dead after a reboot | check the cron jobs; run `pm2 resurrect` |
| CORS errors after login | add the exact frontend origin to `CORS_ORIGINS`, restart with `--update-env` |
| `git push` fails with submodule warnings | remove nested `.git` folders before `git add` |
| React build killed on the server | build locally, upload `dist/` |
