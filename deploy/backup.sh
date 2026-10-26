#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_DIR=$(dirname "$SCRIPT_DIR")
ENV_FILE="$RELEASE_DIR/.env.production"
COMPOSE_FILE="$RELEASE_DIR/compose.production.yaml"
BACKUP_ROOT=${1:-"$RELEASE_DIR/backups"}
STAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then
    compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    compose() { docker-compose "$@"; }
else
    echo 'Docker Compose v2 is required (docker compose or docker-compose).' >&2
    exit 1
fi
mkdir -p "$BACKUP_DIR"

compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U assets -d assets -Fc > "$BACKUP_DIR/database.dump"
compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend \
    tar -C /data/uploads -czf - . > "$BACKUP_DIR/uploads.tar.gz"

sha256sum "$BACKUP_DIR/database.dump" "$BACKUP_DIR/uploads.tar.gz" > "$BACKUP_DIR/SHA256SUMS"
echo "Backup created: $BACKUP_DIR"
