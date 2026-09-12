#!/usr/bin/env bash
set -Eeuo pipefail
# Producers write two real archive names (see backup.sh and
# deploy-production.sh): dzhoot-mongodb-<stamp>.archive.gz directly under the
# backup dir, and <stamp>/dzhoof-iptv.archive.gz inside a per-deploy folder.
# Search both, up to 2 levels deep, and prefer the newest match.
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dzhoot/mongodb}"
BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 2 -type f \( -name 'dzhoof-iptv.archive.gz' -o -name 'dzhoot-mongodb-*.archive.gz' \) -printf '%T@\t%p\n' 2>/dev/null | sort -nr | head -n 1 | cut -f2- || true)"
[ -n "$BACKUP_FILE" ] || { echo '[restore-drill][ABORT] no MongoDB backup found' >&2; exit 1; }
export ALLOW_RESTORE_DRILL=true
export BACKUP_FILE
exec /bin/bash /opt/dzhoot/server/scripts/backup/restore-drill-docker.sh
