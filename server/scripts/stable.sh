#!/usr/bin/env bash
set -Eeuo pipefail

# DZ HOOF stable self-hosted operations.
# Run this from server/ on a VPS or persistent Linux host.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.selfhost.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for stable operation. Install Docker on the persistent host first." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.production.example to .env and fill secrets/images." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

case "${1:-status}" in
  start)
    compose up -d
    ;;
  stop)
    compose stop
    ;;
  restart)
    compose restart
    ;;
  update)
    git pull --ff-only
    compose pull
    compose up -d
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs --tail="${LOG_LINES:-120}" "$2"
    ;;
  health)
    curl -fsS "${PUBLIC_API_URL:-http://127.0.0.1:3000}/health"
    echo
    ;;
  backup)
    backup_dir="${BACKUP_DIR:-$ROOT_DIR/backups}"
    mkdir -p "$backup_dir"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    compose exec -T mongodb mongodump --db=dzhoof-iptv --archive > "$backup_dir/mongodb-$stamp.archive"
    echo "Backup written to $backup_dir/mongodb-$stamp.archive"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|update|status|logs [service]|health|backup}" >&2
    exit 2
    ;;
esac
