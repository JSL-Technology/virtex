import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Point-of-sale shifts and till sales, consolidated from special-enigma's POS domain.
 *
 * Both tables are tenant-scoped and cascade on tenant deletion. A shift is a till session on one
 * terminal; a sale belongs to the shift it was rung in and stores its lines as JSON — a POS ticket
 * is an immutable record, never edited line-by-line, so a child table would buy nothing. Stock is
 * moved by the existing inventory service inside the sale's transaction, so no schema here owns it.
 *
 * camelCase identifiers to match the entity definitions (no snake_case `name:` overrides).
 */
export class Pos1789002300000 implements MigrationInterface {
  name = 'Pos1789002300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "pos_shifts_status_enum" AS ENUM ('OPEN', 'CLOSED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "pos_sales_status_enum" AS ENUM ('PAID', 'CANCELLED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pos_shifts" (
        "id"             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL,
        "terminalId"     character varying(120) NOT NULL,
        "userId"         uuid NOT NULL,
        "openingBalance" numeric(14,2) NOT NULL DEFAULT 0,
        "closingBalance" numeric(14,2),
        "salesTotal"     numeric(14,2) NOT NULL DEFAULT 0,
        "salesCount"     integer NOT NULL DEFAULT 0,
        "status"         "pos_shifts_status_enum" NOT NULL DEFAULT 'OPEN',
        "openedAt"       timestamptz NOT NULL DEFAULT now(),
        "closedAt"       timestamptz,
        CONSTRAINT "FK_pos_shifts_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pos_shifts_org" ON "pos_shifts" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pos_shifts_org_terminal_status"
        ON "pos_shifts" ("organizationId", "terminalId", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pos_sales" (
        "id"             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL,
        "terminalId"     character varying(120) NOT NULL,
        "shiftId"        uuid,
        "items"          jsonb NOT NULL DEFAULT '[]',
        "subtotal"       numeric(14,2) NOT NULL DEFAULT 0,
        "tax"            numeric(14,2) NOT NULL DEFAULT 0,
        "total"          numeric(14,2) NOT NULL DEFAULT 0,
        "paymentMethod"  character varying(60),
        "customerName"   character varying(255),
        "invoiceId"      uuid,
        "status"         "pos_sales_status_enum" NOT NULL DEFAULT 'PAID',
        "createdAt"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_pos_sales_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pos_sales_org" ON "pos_sales" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pos_sales_org_created"
        ON "pos_sales" ("organizationId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pos_sales_org_shift"
        ON "pos_sales" ("organizationId", "shiftId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pos_sales"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pos_shifts"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pos_sales_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pos_shifts_status_enum"`);
  }
}
