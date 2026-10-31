# Respaldos y recuperación

| Qué | Cómo | Dónde |
|---|---|---|
| Respaldo completo de PostgreSQL | `pg_dump` formato custom, comprimido, con checksum | volumen `backups` (`/backups`) |
| Copia fuera del servidor | `BACKUP_S3_URI` (S3, Backblaze B2, Wasabi, DigitalOcean Spaces…) | el bucket |
| Cifrado | `BACKUP_ENCRYPTION_PASSPHRASE` → AES-256 (gpg) antes de subir | — |
| Prueba de restauración | cada domingo: restaura en una base temporal y comprueba migraciones, empresas y que el libro mayor cuadre | log del servicio `backup` |
| Alertas | un respaldo o una prueba fallida se publica en `ALERT_WEBHOOK_URL` | Slack / Teams / Google Chat |

**Objetivos por defecto:** RPO 24 h (un respaldo diario a las `BACKUP_HOUR_UTC`), RTO < 1 h para
una base de pocos GB. Para RPO menor, usa una base administrada con PITR (recuperación a un punto en
el tiempo) **y mantén igualmente este respaldo**: una instantánea del proveedor no es una
restauración probada.

**Conservación legal.** La DGII exige conservar los comprobantes y registros contables **10 años**
(Código Tributario, art. 50). La retención local (`BACKUP_RETENTION_DAYS`) es operativa; configura
en el bucket una regla de ciclo de vida que conserve **un respaldo por mes durante 10 años** (por
ejemplo, transición a almacenamiento frío a los 90 días). El XML firmado de cada e-CF emitido y
recibido está dentro de la base (`ecf_submissions.signed_xml`, `ecf_received_documents.xml`).

## Operaciones

```bash
# Respaldo inmediato
docker compose -f deploy/docker-compose.prod.yml exec backup /backup/backup.sh

# Probar la restauración del último respaldo (no toca la base viva)
docker compose -f deploy/docker-compose.prod.yml exec backup /backup/verify-restore.sh

# Restaurar sobre la base viva (DESTRUCTIVO; detén primero api y web)
docker compose -f deploy/docker-compose.prod.yml stop api web
docker compose -f deploy/docker-compose.prod.yml run --rm backup /backup/restore.sh /backups/virteex-<fecha>.dump
docker compose -f deploy/docker-compose.prod.yml up -d
```

Los archivos subidos (adjuntos, logos) viven en el volumen `uploads` o en S3 (`STORAGE_DRIVER=s3`).
Con almacenamiento local, inclúyelo en el respaldo del servidor o usa S3 con versionado.
