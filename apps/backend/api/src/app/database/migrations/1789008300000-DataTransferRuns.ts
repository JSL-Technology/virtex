import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The history behind «Exportaciones / Importaciones recientes» (QA A-10).
 *
 * Both lists were a hard-coded array — July 2025, «Admin Principal», «Ana Pérez» — beside buttons
 * that did nothing. Each real export and import is now recorded here: who ran it, on which
 * dataset, how many rows, and the problems that stopped it. Tenant-isolated like every tenant
 * table, and erased with its tenant.
 */
export class DataTransferRuns1789008300000 implements MigrationInterface {
  name = 'DataTransferRuns1789008300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "data_transfer_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "kind" character varying(8) NOT NULL,
        "dataset" character varying(64) NOT NULL,
        "format" character varying(8) NOT NULL,
        "file_name" character varying(255),
        "status" character varying(16) NOT NULL,
        "total_rows" integer NOT NULL DEFAULT 0,
        "imported_rows" integer NOT NULL DEFAULT 0,
        "failed_rows" integer NOT NULL DEFAULT 0,
        "problems" jsonb NOT NULL DEFAULT '[]',
        "user_id" uuid,
        "user_name" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_data_transfer_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_data_transfer_runs_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_data_transfer_runs_org_created"
        ON "data_transfer_runs" ("organization_id", "created_at")
    `);
    const predicate = `organization_id = (NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`ALTER TABLE "data_transfer_runs" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "data_transfer_runs" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "data_transfer_runs"`);
    await q.query(`CREATE POLICY tenant_isolation ON "data_transfer_runs" USING (${predicate}) WITH CHECK (${predicate})`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "data_transfer_runs"`);
  }
}
