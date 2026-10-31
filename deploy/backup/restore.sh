#!/usr/bin/env bash
# Restore a backup over the live database. DESTRUCTIVE: stop the API first.
#
#   docker compose -f deploy/docker-compose.prod.yml stop api web
#   docker compose -f deploy/docker-compose.prod.yml run --rm backup /backup/restore.sh /backups/virteex-<stamp>.dump
#   docker compose -f deploy/docker-compose.prod.yml up -d
set -euo pipefail
FILE="${1:?usage: restore.sh <dump file>}"
[ -f "$FILE.sha256" ] && sha256sum -c "$FILE.sha256"
read -r -p "Esto reemplaza la base ${PGDATABASE}. Escribe RESTAURAR para continuar: " answer
[ "$answer" = "RESTAURAR" ] || { echo "cancelado"; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$PGDATABASE" "$FILE"
echo "Restaurado. Ejecuta las migraciones (servicio migrate) antes de volver a arrancar la API."
