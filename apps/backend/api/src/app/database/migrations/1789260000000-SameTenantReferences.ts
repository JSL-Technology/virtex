import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A foreign key between two tenant tables must point at a row of the SAME tenant.
 *
 * ## Why the database has to say it
 *
 * The audit of 2026-10-31 (MT-03) reproduced six endpoints that wrote rows referencing another
 * company's data: a parent account, a price-list product, a BOM component, a landed-cost account,
 * a timesheet task, a period lock. Each was fixed in its service, but a rule enforced only where a
 * developer remembered it is exactly what failed six times. Row-level security does not help here:
 * PostgreSQL checks foreign keys WITHOUT applying RLS, so the INSERT succeeds even when the session
 * cannot see the referenced row.
 *
 * ## What this installs
 *
 *  - `virtex_assert_same_tenant()`: a constraint-trigger function that, for the foreign-key column
 *    it guards, checks that the referenced row's `organization_id` equals the new row's (or is NULL:
 *    a global catalogue row). It reads through the session, so under the application role RLS also
 *    hides foreign rows from the check — both ways agree.
 *  - `virtex_install_same_tenant_guards()`: walks the catalogue and installs one DEFERRABLE
 *    INITIALLY DEFERRED constraint trigger per single-column foreign key whose source AND target
 *    carry `organization_id`. Deferred, so a document and its lines can be inserted in any order
 *    inside a transaction; the check runs at COMMIT. It is idempotent, and a later migration that
 *    adds foreign keys calls it again (the integration test `same-tenant-references.spec.ts` fails
 *    if any eligible foreign key is left unguarded).
 *
 * Two targets are excluded on purpose:
 *  - `organizations`: the reference IS the tenant column (or a deliberate cross-company link such as
 *    intercompany or consolidation).
 *  - `users`: `users.organization_id` is a person's HOME organization, and a person legitimately
 *    works for several. Membership is checked by the application (`assertTenantMember`).
 *
 * The violation is raised as SQLSTATE 23503 with a message that the exception filter maps to a 400
 * ("references a record that does not exist") — it never says the row exists elsewhere.
 */
export class SameTenantReferences1789260000000 implements MigrationInterface {
  name = 'SameTenantReferences1789260000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_assert_same_tenant() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      DECLARE
        ref_table text := TG_ARGV[0];
        fk_col    text := TG_ARGV[1];
        ref_col   text := TG_ARGV[2];
        ref_value text;
        row_org   uuid;
        ok        boolean;
      BEGIN
        -- A deferred check runs at COMMIT for every row event of the transaction, including rows
        -- deleted afterwards (a tenant deletion cascades through updates and deletes). A row that
        -- no longer exists in this version references nothing; its live version, if any, has its
        -- own event.
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE ctid = $1)', TG_TABLE_NAME) INTO ok USING NEW.ctid;
        IF NOT ok THEN
          RETURN NULL;
        END IF;
        ref_value := to_jsonb(NEW) ->> fk_col;
        row_org   := (to_jsonb(NEW) ->> 'organization_id')::uuid;
        IF ref_value IS NULL OR row_org IS NULL THEN
          RETURN NULL;
        END IF;
        EXECUTE format(
          'SELECT EXISTS (SELECT 1 FROM %I WHERE %I::text = $1 AND (organization_id = $2 OR organization_id IS NULL))',
          ref_table, ref_col
        ) INTO ok USING ref_value, row_org;
        IF NOT ok THEN
          RAISE EXCEPTION 'insert or update on table "%" references a record that is not available to its tenant (column %)',
            TG_TABLE_NAME, fk_col
            USING ERRCODE = '23503';
        END IF;
        RETURN NULL;
      END
      $fn$;
    `);

    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_install_same_tenant_guards() RETURNS integer
      LANGUAGE plpgsql AS $fn$
      DECLARE
        fk record;
        trigger_name text;
        installed integer := 0;
      BEGIN
        FOR fk IN
          SELECT c.conname,
                 src.relname AS src_table,
                 a.attname   AS fk_col,
                 dst.relname AS dst_table,
                 af.attname  AS ref_col
          FROM pg_constraint c
          JOIN pg_class src ON src.oid = c.conrelid
          JOIN pg_class dst ON dst.oid = c.confrelid
          JOIN pg_namespace n ON n.oid = src.relnamespace AND n.nspname = 'public'
          JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
          JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
          WHERE c.contype = 'f'
            AND array_length(c.conkey, 1) = 1
            AND dst.relname NOT IN ('organizations', 'users')
            AND a.attname <> 'organization_id'
            AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid  AND x.attname = 'organization_id' AND NOT x.attisdropped)
            AND EXISTS (SELECT 1 FROM pg_attribute y WHERE y.attrelid = c.confrelid AND y.attname = 'organization_id' AND NOT y.attisdropped)
        LOOP
          trigger_name := 'tg_same_tenant_' || substr(md5(fk.conname), 1, 24);
          EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, fk.src_table);
          EXECUTE format(
            'CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE OF %I ON %I '
            'DEFERRABLE INITIALLY DEFERRED FOR EACH ROW '
            'EXECUTE FUNCTION virtex_assert_same_tenant(%L, %L, %L)',
            trigger_name, fk.fk_col, fk.src_table, fk.dst_table, fk.fk_col, fk.ref_col
          );
          installed := installed + 1;
        END LOOP;
        RETURN installed;
      END
      $fn$;
    `);

    await q.query(`SELECT virtex_install_same_tenant_guards()`);

    // Two tenant tables carried a platform-wide unique key: a company could not reuse a customer
    // group name or a lead e-mail another company had, and the refusal told it that the other
    // company had one. Unique per company instead.
    await q.query(`ALTER TABLE customer_groups DROP CONSTRAINT IF EXISTS "UQ_2c34493d318d99b838f72707661"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_2c34493d318d99b838f72707661"`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_groups_org_name" ON customer_groups (organization_id, name)`);
    await q.query(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS "UQ_b3eea7add0e16594dba102716c5"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_b3eea7add0e16594dba102716c5"`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_leads_org_email" ON leads (organization_id, email)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_leads_org_email"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_customer_groups_org_name"`);
    await q.query(`
      DO $do$
      DECLARE t record;
      BEGIN
        FOR t IN
          SELECT tgname, tgrelid::regclass AS rel FROM pg_trigger WHERE tgname LIKE 'tg_same_tenant_%'
        LOOP
          EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', t.tgname, t.rel);
        END LOOP;
      END
      $do$;
    `);
    await q.query(`DROP FUNCTION IF EXISTS virtex_install_same_tenant_guards()`);
    await q.query(`DROP FUNCTION IF EXISTS virtex_assert_same_tenant()`);
  }
}
