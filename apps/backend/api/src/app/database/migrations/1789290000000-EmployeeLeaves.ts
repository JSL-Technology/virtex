import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vacations and other leave.
 *
 * Vacations appeared only inside a severance liquidation: a company could compute what it owed a
 * departing employee for untaken vacation, but not record the vacation anyone took, so that figure
 * was always «all of it». Each leave is a row now — requested, approved or rejected — and the
 * vacation balance (Código de Trabajo, arts. 177 and 180) is what the law grants for the service
 * year less what was approved against it.
 */
export class EmployeeLeaves1789290000000 implements MigrationInterface {
  name = 'EmployeeLeaves1789290000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "employee_leaves" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "business_days" numeric(6,2) NOT NULL,
        "service_year" integer NULL,
        "status" varchar(16) NOT NULL DEFAULT 'REQUESTED',
        "reason" text NULL,
        "decision_note" text NULL,
        "requested_by_id" uuid NULL,
        "decided_by_id" uuid NULL,
        "decided_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_leaves" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_employee_leaves_kind" CHECK ("kind" IN ('VACATION', 'SICK', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'MARRIAGE', 'UNPAID', 'OTHER')),
        CONSTRAINT "CHK_employee_leaves_status" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
        CONSTRAINT "CHK_employee_leaves_dates" CHECK ("end_date" >= "start_date"),
        CONSTRAINT "FK_employee_leaves_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_employee_leaves_employee" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_employee_leaves_org_employee" ON "employee_leaves" ("organization_id", "employee_id", "start_date")`,
    );
    await q.query(`ALTER TABLE "employee_leaves" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "employee_leaves" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "employee_leaves"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "employee_leaves"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "employee_leaves"`);
  }
}
