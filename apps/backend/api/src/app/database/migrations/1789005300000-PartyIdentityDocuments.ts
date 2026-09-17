import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give customers and suppliers a document TYPE, and stop assuming suppliers are Dominican.
 *
 * ## What was missing
 *
 * Sales and purchasing each carried a bare `tax_id` varchar with `@IsString()` behind it and
 * nothing beside it. So:
 *
 *   - a Dominican customer's RNC (a company) and cédula (a person) were the same column with no
 *     way to tell them apart except length — the heuristic `create-invoice.dto.ts` records having
 *     removed from the document type for being wrong — while the e-CF has to state which it is;
 *   - a mistyped NIT, RUT or RFC was accepted and stored, and surfaced months later when the
 *     authority rejected an invoice or a purchase return built from it;
 *   - the field had to be labelled "RNC / Cédula", "CNPJ / CPF", "EIN / TIN", because one input
 *     was doing the work of two.
 *
 * ## `suppliers.country` lost its default
 *
 * It was `DEFAULT 'DO'`. That column exists to tell a domestic purchase from a payment abroad —
 * the DGII's 609 reports the latter with income tax withheld at source — so a supplier created by
 * a Chilean tenant was silently classified as domestic-Dominican, which is a wrong filing rather
 * than a cosmetic default. `SuppliersService` now fills it from the tenant's country.
 *
 * Existing rows keep the value they have: a row that says `DO` because the default applied is
 * indistinguishable from one that says `DO` because somebody meant it, and rewriting the first
 * kind would need a fact the database does not hold.
 *
 * ## Why no foreign key here
 *
 * `employees` gets one, because an employee is always a natural person the tenant employs and the
 * catalogue necessarily covers them. A customer or supplier may be established anywhere — an
 * exporter's buyers are abroad by definition — and the catalogue is seeded for the nineteen
 * markets the product SELLS in, not for every country a counterparty can be in. A foreign key
 * would therefore refuse a legitimate Panamanian buyer for a Dominican tenant. `SuppliersService`
 * and `CustomersService` validate against the catalogue and reject an unknown type at the door,
 * which is the check that matters, without making the schema claim a completeness it lacks.
 */
export class PartyIdentityDocuments1789005300000 implements MigrationInterface {
  name = 'PartyIdentityDocuments1789005300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['customers', 'suppliers']) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD COLUMN IF NOT EXISTS "identity_document_type_code" character varying(32),
          ADD COLUMN IF NOT EXISTS "identity_document_country" character(2)
      `);

      // Both halves travel together, same reasoning as on `employees`: a code with no country
      // cannot be resolved, and a country with no code records a document whose kind is unknown.
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "CK_${table}_identity_document_pair"
          CHECK (
            ("identity_document_type_code" IS NULL AND "identity_document_country" IS NULL)
            OR ("identity_document_type_code" IS NOT NULL AND "identity_document_country" IS NOT NULL)
          )
      `);
    }

    await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "country" DROP DEFAULT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "country" SET DEFAULT 'DO'`);

    for (const table of ['customers', 'suppliers']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CK_${table}_identity_document_pair"`,
      );
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP COLUMN IF EXISTS "identity_document_country",
          DROP COLUMN IF EXISTS "identity_document_type_code"
      `);
    }
  }
}
