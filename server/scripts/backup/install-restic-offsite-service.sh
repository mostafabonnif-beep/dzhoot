#!/usr/bin/env bash
# Install the versioned DZ HOOF off-site restic timers after configuration.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dzhoot/server}"
CONFIG_FILE="${CONFIG_FILE:-/etc/dzhoot/restic-offsite.env}"
UNIT_DIR="/etc/systemd/system"

[ "$(id -u)" -eq 0 ] || { echo 'Run as root.' >&2; exit 1; }
[ -x "$APP_DIR/scripts/backup/restic-offsite-backup.sh" ] || {
  echo "Backup script missing or not executable: $APP_DIR/scripts/backup/restic-offsite-backup.sh" >&2
  exit 1
}

CONFIG_FILE="$CONFIG_FILE" "$APP_DIR/scripts/backup/restic-offsite-backup.sh" --dry-run

install -m 644 "$APP_DIR/scripts/backup/systemd/dzhoof-restic-offsite-backup.service" "$UNIT_DIR/dzhoof-restic-offsite-backup.service"
install -m 644 "$APP_DIR/scripts/backup/systemd/dzhoof-restic-offsite-backup.timer" "$UNIT_DIR/dzhoof-restic-offsite-backup.timer"
install -m 644 "$APP_DIR/scripts/backup/systemd/dzhoof-restic-offsite-check.service" "$UNIT_DIR/dzhoof-restic-offsite-check.service"
install -m 644 "$APP_DIR/scripts/backup/systemd/dzhoof-restic-offsite-check.timer" "$UNIT_DIR/dzhoof-restic-offsite-check.timer"
systemctl daemon-reload
systemctl enable --now dzhoof-restic-offsite-backup.timer dzhoof-restic-offsite-check.timer
systemctl list-timers dzhoof-restic-offsite-backup.timer dzhoof-restic-offsite-check.timer --no-pager
