import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replace the Dominican document enum on `employees` with a reference to the catalogue, and give
 * the social-security columns names that are not the names of Dominican institutions.
 *
 * ## The enum
 *
 * `employees.identity_document_type` was `employees_identity_document_type_enum`, holding
 * `CEDULA`, `PASSPORT` and `RNC`, `NOT NULL DEFAULT 'CEDULA'`, on a table shared by nineteen
 * markets. Three consequences, each worse than the last:
 *
 *   1. adding a country's document required `ALTER TYPE … ADD VALUE` — a migration and a deploy —
 *      in a type PostgreSQL will never let you shrink again;
 *   2. the `NOT NULL DEFAULT 'CEDULA'` meant every employee of every country was born holding a
 *      Dominican document, so "not stated" and "is a Dominican cédula" were the same stored value;
 *   3. the value was validated with the Dominican JCE and DGII algorithms whatever the tenant's
 *      country, while the translation catalogue relabelled the same enum value as "SSN", "RUN",
 *      "DNI", "CPF" and "CURP / INE" per locale — so seven markets were invited to enter a
 *      document the server then rejected for not being Dominican.
 *
 * ## The migration of existing data
 *
 * Every existing row is Dominican by construction: no other market could store a document, because
 * no other market's documents passed the validator. They are therefore mapped to `('DO', <code>)`,
 * with `PASSPORT` going to the supranational `XX` — a passport belongs to the traveller's state,
 * not the employer's.
 *
 * Rows whose `identity_document` is NULL get a NULL type, undoing the default: they never had a
 * document, and recording that they hold a Dominican cédula would be inventing data.
 *
 * ## Why the reference is a PAIR, and why it is not a foreign key
 *
 * `(identity_document_country, identity_document_type_code)` is the catalogue's natural key. The
 * code alone does not identify a document — a "cédula" is eleven digits with a Luhn check in Santo
 * Domingo, six to ten digits with none in Bogotá, and a tax identifier in San José — so storing
 * the code without the country is what would let a Colombian employee be checked by the Dominican
 * rule, the exact class of error this change removes.
 *
 * It is not a FOREIGN KEY, though, and that is a decision rather than an omission. TypeORM emits
 * no constraint for a composite relation that references non-primary columns, so a foreign key
 * written in SQL alone would be an object the entities never describe, and `check:schema-drift`
 * would report it on every run for ever. What guards the pair instead is a CHECK that keeps both
 * halves present or both absent, and `IdentityDocumentService.resolveParty()`, through which every
 * write path passes and which refuses a code the resolved country does not issue.
 *
 * ## The social-security columns
 *
 * `tss_nss`, `afp_code` and `sfs_code` named the Tesorería de la Seguridad Social, the
 * Administradora de Fondos de Pensiones and the Seguro Familiar de Salud — three Dominican
 * institutions in the schema of a shared table, so a Peruvian tenant stored an ESSALUD code in a
 * column called `sfs_code`. The concepts generalise; the names did not. Renamed rather than
 * recreated, so the data moves with them.
 */
export class EmployeeIdentityDocumentCatalogue1789005200000 implements MigrationInterface {
  name = 'EmployeeIdentityDocumentCatalogue1789005200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. The new identity columns ─────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "employees"
        ADD COLUMN IF NOT EXISTS "identity_document_type_code" character varying(32),
        ADD COLUMN IF NOT EXISTS "identity_document_country" character(2)
    `);

    // ── 2. Backfill ─────────────────────────────────────────────────────────
    // Only rows that actually carry a document. The rest had the enum's default, which asserted a
    // Dominican cédula for people whose document was never captured.
    await queryRunner.query(`
      UPDATE "employees"
         SET "identity_document_type_code" = "identity_document_type"::text,
             "identity_document_country"   = CASE
               WHEN "identity_document_type"::text = 'PASSPORT' THEN 'XX'
               ELSE 'DO'
             END
       WHERE "identity_document" IS NOT NULL
    `);

    // ── 3. Retire the enum ──────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN IF EXISTS "identity_document_type"`);
    // The type is dropped only once nothing uses it. IF EXISTS because a database restored from a
    // dump taken after an earlier partial run may not have it.
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."employees_identity_document_type_enum"`);

    // ── 4. The pair-coherence constraint ────────────────────────────────────
    //
    // There is deliberately NO foreign key to `identity_document_types` here. TypeORM emits no
    // constraint for a composite relation that references non-primary columns, so a foreign key
    // written in SQL alone would be an object the entities never describe — `check:schema-drift`
    // would report it on every run, for ever, and a drift check that is always red is a drift
    // check nobody reads.
    //
    // Integrity is kept by the CHECK below and by `IdentityDocumentService.resolveParty()`, which
    // every write path passes through and which refuses a code the resolved country does not
    // issue. It is the same arrangement `customers` and `suppliers` use — and there a foreign key
    // would be wrong outright, because a counterparty can be established in a country the
    // catalogue does not cover, and the key would refuse a legitimate foreign buyer.
    // Both halves of the pair travel together: a code without a country cannot be resolved, and a
    // country without a code says a document was recorded whose kind nobody knows.
    await queryRunner.query(`
      ALTER TABLE "employees"
        ADD CONSTRAINT "CK_employees_identity_document_pair"
        CHECK (
          ("identity_document_type_code" IS NULL AND "identity_document_country" IS NULL)
          OR ("identity_document_type_code" IS NOT NULL AND "identity_document_country" IS NOT NULL)
        )
    `);

    // ── 5. Neutral names for the social-security columns ────────────────────
    await queryRunner.query(
      `ALTER TABLE "employees" RENAME COLUMN "tss_nss" TO "social_security_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" RENAME COLUMN "afp_code" TO "pension_fund_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" RENAME COLUMN "sfs_code" TO "health_fund_code"`,
    );

    // The escape hatch that keeps the next country from adding schema: a Brazilian PIS or a
    // Colombian ARL is a key here, not a fourth nullable column and another migration.
    await queryRunner.query(
      `ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "statutory_enrolment" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN IF EXISTS "statutory_enrolment"`);
    await queryRunner.query(
      `ALTER TABLE "employees" RENAME COLUMN "health_fund_code" TO "sfs_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" RENAME COLUMN "pension_fund_code" TO "afp_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" RENAME COLUMN "social_security_number" TO "tss_nss"`,
    );

    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "CK_employees_identity_document_pair"`,
    );

    await queryRunner.query(`
      CREATE TYPE "public"."employees_identity_document_type_enum"
        AS ENUM ('CEDULA', 'PASSPORT', 'RNC')
    `);
    await queryRunner.query(`
      ALTER TABLE "employees"
        ADD COLUMN "identity_document_type" "public"."employees_identity_document_type_enum"
        NOT NULL DEFAULT 'CEDULA'
    `);
    // A row whose document is not one of the three the enum can express — a Colombian cédula de
    // ciudadanía, say — has no representation in the old schema. It falls to the enum's default,
    // which is exactly the data loss this migration exists to make impossible going forward.
    await queryRunner.query(`
      UPDATE "employees"
         SET "identity_document_type" = "identity_document_type_code"::"public"."employees_identity_document_type_enum"
       WHERE "identity_document_type_code" IN ('CEDULA', 'PASSPORT', 'RNC')
    `);

    await queryRunner.query(
      `ALTER TABLE "employees" DROP COLUMN IF EXISTS "identity_document_country"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" DROP COLUMN IF EXISTS "identity_document_type_code"`,
    );
  }
}
