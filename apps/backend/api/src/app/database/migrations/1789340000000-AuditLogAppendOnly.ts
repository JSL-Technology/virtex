import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit trail is append-only (audit 2026-10-31, AUD-02).
 *
 * `audit_logs` could be updated and deleted by the application role: whoever could reach the
 * database as the application could rewrite who did what, which defeats the only purpose of the
 * table. Now:
 *
 *  - UPDATE is refused, always. A trail is corrected by a new row, never by editing an old one.
 *  - DELETE is refused, except as the tail of deleting a whole tenant (its organization is already
 *    gone in the same statement — the same rule the ledger's delete guard uses), so the right to
 *    erase a customer's data still works.
 *  - The application role loses UPDATE and DELETE on the table outright, so the trigger is the
 *    second line, not the only one.
 */
export class AuditLogAppendOnly1789340000000 implements MigrationInterface {
  name = 'AuditLogAppendOnly1789340000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_audit_log"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'La bitácora de auditoría no se modifica: se corrige con una entrada nueva.'
            USING ERRCODE = 'check_violation';
        END IF;
        -- DELETE: only when the tenant itself is being deleted (cascade from organizations).
        IF OLD."organization_id" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'La bitácora de auditoría no se borra.'
          USING ERRCODE = 'check_violation';
      END;
      $$;
    `);
    await q.query(`DROP TRIGGER IF EXISTS "trg_audit_logs_append_only" ON "audit_logs"`);
    await q.query(`
      CREATE TRIGGER "trg_audit_logs_append_only"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "virtex_guard_audit_log"()
    `);
    await q.query(`
      DO $do$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          REVOKE UPDATE, DELETE ON "audit_logs" FROM "virtex_app";
        END IF;
      END
      $do$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS "trg_audit_logs_append_only" ON "audit_logs"`);
    await q.query(`DROP FUNCTION IF EXISTS "virtex_guard_audit_log"()`);
    await q.query(`
      DO $do$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT UPDATE, DELETE ON "audit_logs" TO "virtex_app";
        END IF;
      END
      $do$;
    `);
  }
}
