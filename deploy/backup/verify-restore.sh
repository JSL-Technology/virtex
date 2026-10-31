#!/usr/bin/env bash
# Prove the newest backup restores: into a scratch database, then ask it questions only a complete
# restore answers — the migration history, the tenants, the ledger balancing to zero.
set -euo pipefail
LATEST=$(ls -1t /backups/virteex-*.dump 2>/dev/null | head -1)
[ -n "$LATEST" ] || { echo "no backup to verify" >&2; exit 1; }
sha256sum -c "$LATEST.sha256" >/dev/null

SCRATCH="virteex_restore_check"
psql -d postgres -qc "DROP DATABASE IF EXISTS $SCRATCH"
psql -d postgres -qc "CREATE DATABASE $SCRATCH"
trap 'psql -d postgres -qc "DROP DATABASE IF EXISTS '"$SCRATCH"'" >/dev/null 2>&1 || true' EXIT

pg_restore --no-owner --no-privileges --exit-on-error -d "$SCRATCH" "$LATEST"

migrations=$(psql -d "$SCRATCH" -Atc 'SELECT count(*) FROM migrations')
tenants=$(psql -d "$SCRATCH" -Atc 'SELECT count(*) FROM organizations')
imbalance=$(psql -d "$SCRATCH" -Atc "SELECT coalesce(round(sum(debit) - sum(credit), 2), 0) FROM journal_entry_line_valuations")
[ "$migrations" -gt 0 ] || { echo "restored database has no migration history" >&2; exit 1; }
[ "$imbalance" = "0" ] || [ "$imbalance" = "0.00" ] || { echo "restored ledger does not balance: $imbalance" >&2; exit 1; }
echo "[restore-check] $(basename "$LATEST"): $migrations migrations, $tenants tenants, ledger balanced"
