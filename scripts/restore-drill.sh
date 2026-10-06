#!/usr/bin/env bash
# Restore drill: restores the newest backup into a scratch database on a NON-production server and verifies it
# (migrations applied, all declared indexes present, no tenant-owned document without tenantId). Run it monthly and after
# every schema change; the result is the evidence that backups are restorable. Never point DRILL_MONGO_URL at production.
set -euo pipefail
: "${DRILL_MONGO_URL:?set DRILL_MONGO_URL to a scratch MongoDB (not production)}"
SRC_DB="${SOURCE_DB:-leaddesk}"; BACKUP_DIR="${BACKUP_DIR:-./backups}"
FILE="${1:-$(ls -1t "$BACKUP_DIR"/leaddesk-*.archive.gz | head -n1)}"
[[ -f "$FILE" ]] || { echo "no backup found"; exit 2; }
( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" )   # corrupted archive fails here
SCRATCH="drill_$(date -u +%Y%m%d%H%M%S)"
echo "restoring $FILE into $SCRATCH"
mongorestore --uri "$DRILL_MONGO_URL" --archive="$FILE" --gzip --nsFrom "${SRC_DB}.*" --nsTo "${SCRATCH}.*" --drop
node -r @swc-node/register "$(dirname "$0")/verify-restore.ts" "$DRILL_MONGO_URL" "$SCRATCH" --min-tenants "${MIN_TENANTS:-1}" && RESULT=ok || RESULT=FAILED
mongosh "$DRILL_MONGO_URL" --quiet --eval "db.getSiblingDB('$SCRATCH').dropDatabase()" >/dev/null
echo "restore drill: $RESULT"; [[ "$RESULT" == ok ]]
