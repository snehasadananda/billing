#!/bin/bash
# Keeps the API alive on shared hosting where pm2 startup / sudo is unavailable.
# Cron (every 5 min):   */5 * * * * bash $HOME/billing-app/deploy/start_backend.sh >/dev/null 2>&1
# Cron (on reboot):     @reboot bash $HOME/billing-app/deploy/start_backend.sh >/dev/null 2>&1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
APP_DIR="${APP_DIR:-$HOME/billing-app/backend}"
cd "$APP_DIR" || exit 1
if ! pm2 describe billing-backend >/dev/null 2>&1; then
  pm2 resurrect >/dev/null 2>&1 || true
fi
if ! pm2 describe billing-backend >/dev/null 2>&1; then
  pm2 start server.js --name billing-backend --update-env
  pm2 save
fi
