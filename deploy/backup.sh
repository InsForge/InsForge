#!/usr/bin/env bash
# Back up a self-hosted InsForge install: logical Postgres dump + .env copy.
#
# Run by path (use the shebang — this script requires bash):
#   ~/insforge/deploy/backup.sh
#   ./deploy/backup.sh              # when cwd is the install root
#
# Requires a running stack and a readable .env beside this checkout.
# Override defaults:
#   RETENTION_DAYS=30 ./deploy/backup.sh
#   BACKUP_DIR=/mnt/backups/insforge ./deploy/backup.sh
set -euo pipefail
umask 077

INSTALL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$INSTALL_ROOT/.env"
BACKUP_DIR="${BACKUP_DIR:-$INSTALL_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_PATH="$BACKUP_DIR/db_$TIMESTAMP.sql"
DUMP_TMP="${DUMP_PATH}.tmp"

trap 'echo "[$(date -Iseconds)] ERROR: Backup failed at line $LINENO" >&2; rm -f "$DUMP_TMP"; exit 1' ERR

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env at $ENV_FILE — run deploy/setup.sh in this directory first." >&2
  exit 1
fi

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "RETENTION_DAYS must be a non-negative integer (got: $RETENTION_DAYS)" >&2
  exit 1
fi

cd "$INSTALL_ROOT"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-insforge}" \
  > "$DUMP_TMP"

if [ ! -s "$DUMP_TMP" ]; then
  rm -f "$DUMP_TMP"
  echo "pg_dump produced an empty file — is postgres running?" >&2
  exit 1
fi

mv "$DUMP_TMP" "$DUMP_PATH"
cp "$ENV_FILE" "$BACKUP_DIR/env_$TIMESTAMP.bak"

find "$BACKUP_DIR" -name 'db_*.sql' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'env_*.bak' -mtime +"$RETENTION_DAYS" -delete

echo "[$(date -Iseconds)] Backup completed: db_$TIMESTAMP.sql"
