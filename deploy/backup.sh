#!/bin/bash
# Daily MySQL backup with rotation. Cron:   30 2 * * * bash $HOME/billing-app/deploy/backup.sh
# Reads DB credentials from backend/.env. Keeps 14 daily, 8 weekly (Sunday) and 12 monthly (1st) backups.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/billing-app/backend}"
set -a; . "$APP_DIR/.env"; set +a
DIR="${BACKUP_DIR:-$APP_DIR/backups}"; mkdir -p "$DIR/daily" "$DIR/weekly" "$DIR/monthly"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$DIR/daily/${DB_NAME}-$STAMP.sql.gz"
MYSQL_PWD="$DB_PASSWORD" mysqldump -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "$DB_USER" --single-transaction --routines --no-tablespaces "$DB_NAME" | gzip > "$FILE"
[ "$(date +%u)" = "7" ] && cp "$FILE" "$DIR/weekly/"
[ "$(date +%d)" = "01" ] && cp "$FILE" "$DIR/monthly/"
find "$DIR/daily" -type f -mtime +14 -delete; find "$DIR/weekly" -type f -mtime +56 -delete; find "$DIR/monthly" -type f -mtime +365 -delete
# copy at the top level so the app's Backup status screen can see the latest one
cp "$FILE" "$DIR/latest.sql.gz"
echo "Backup written: $FILE"
