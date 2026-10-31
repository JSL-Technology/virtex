#!/usr/bin/env bash
# One backup: a compressed custom-format pg_dump (restorable table by table), checksummed,
# optionally encrypted (BACKUP_ENCRYPTION_PASSPHRASE) and copied off-site (BACKUP_S3_URI).
#
# The DGII requires fiscal records to be kept for ten years; retention here is the operational
# window (BACKUP_RETENTION_DAYS). Keep monthly copies off-site under a lifecycle rule for the
# legal horizon — see deploy/backup/README.md.
set -euo pipefail
DIR=/backups
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$DIR/virteex-$STAMP.dump"

pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$FILE"
pg_restore --list "$FILE" >/dev/null   # the archive is readable, not just written
sha256sum "$FILE" > "$FILE.sha256"

if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
      --symmetric --cipher-algo AES256 -o "$FILE.gpg" "$FILE"
  UPLOAD="$FILE.gpg"
else
  UPLOAD="$FILE"
fi

if [ -n "${BACKUP_S3_URI:-}" ]; then
  ENDPOINT=()
  [ -n "${AWS_ENDPOINT_URL:-}" ] && ENDPOINT=(--endpoint-url "$AWS_ENDPOINT_URL")
  aws "${ENDPOINT[@]}" s3 cp "$UPLOAD" "${BACKUP_S3_URI%/}/$(basename "$UPLOAD")" --only-show-errors
  aws "${ENDPOINT[@]}" s3 cp "$FILE.sha256" "${BACKUP_S3_URI%/}/$(basename "$FILE").sha256" --only-show-errors
fi

find "$DIR" -name 'virteex-*' -mtime "+${BACKUP_RETENTION_DAYS:-35}" -delete
echo "[backup] $(basename "$FILE") $(du -h "$FILE" | cut -f1)"
