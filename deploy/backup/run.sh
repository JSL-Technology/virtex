#!/usr/bin/env bash
# Nightly backup loop: dump at BACKUP_HOUR_UTC, prune past BACKUP_RETENTION_DAYS, copy off-site when
# BACKUP_S3_URI is set, and every Sunday prove the newest dump restores. A failure posts to
# ALERT_WEBHOOK_URL: a backup that fails quietly is the same as no backup.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

alert() {
  echo "[backup] $1" >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -H 'Content-Type: application/json' -d "{\"text\":\"🛑 Respaldo Virteex: $1\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}

command -v curl >/dev/null || (apt-get update -qq && apt-get install -y -qq curl gnupg awscli >/dev/null 2>&1 || true)

while true; do
  now_hour=$(date -u +%H)
  if [ "$((10#$now_hour))" -eq "${BACKUP_HOUR_UTC:-7}" ]; then
    if "$HERE/backup.sh"; then
      if [ "$(date -u +%u)" = "7" ]; then
        "$HERE/verify-restore.sh" || alert "la prueba semanal de restauración FALLÓ"
      fi
    else
      alert "el respaldo nocturno FALLÓ"
    fi
    sleep 3700
  fi
  sleep 300
done
