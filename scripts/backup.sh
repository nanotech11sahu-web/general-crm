#!/usr/bin/env bash
# Logical backup of the LeadDesk database (mongodump, gzip archive) with checksum, retention and optional S3 upload.
# Atlas / managed MongoDB: prefer continuous backup + point-in-time restore; use this for self-hosted installs and as an
# independent second copy. The archive holds customer data and *sealed* credentials (useless without the KEK): treat it as
# sensitive, store it encrypted (bucket SSE / age / gpg) and never in the repo.
set -euo pipefail
: "${MONGO_URL:?set MONGO_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"; RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"; umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; OUT="$BACKUP_DIR/leaddesk-$STAMP.archive.gz"
mongodump --uri "$MONGO_URL" --readPreference=secondaryPreferred --archive="$OUT" --gzip
( cd "$BACKUP_DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"
if [[ -n "${BACKUP_S3_URI:-}" ]]; then aws s3 cp "$OUT" "$BACKUP_S3_URI/" --sse AES256 && aws s3 cp "$OUT.sha256" "$BACKUP_S3_URI/"; fi
find "$BACKUP_DIR" -name 'leaddesk-*.archive.gz*' -mtime +"$RETENTION_DAYS" -delete
