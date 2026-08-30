import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record what kind of taxpayer a tenant is, what its country's regime additionally requires, and
 * whether its stored tax id can still be trusted.
 *
 * ## Why the columns exist
 *
 * Nine of the nineteen markets issue a different fiscal identifier to a company than to a natural
 * person, or encode the distinction inside one identifier. Registration never asked, so the
 * validator had to accept the union of both schemes — materially weaker — and the invoice layer
 * had nothing to put in the fields that name the taxpayer's kind.
 *
 * `fiscal_profile` holds the rest of what each authority demands and which the product never
 * collected: `RegimenFiscal` for a CFDI 4.0, `Condición frente al IVA` and `Punto de Venta` for an
 * AFIP invoice, `responsabilidades fiscales` for DIAN, `CRT` and `Inscrição Estadual` for an NF-e,
 * `giro` and `código de actividad` for the SII, `ubigeo` for SUNAT. Without them a tenant can be
 * onboarded and then cannot issue a single compliant document.
 *
 * ## Why `tax_id_verified_at` exists, and why some rows get NULL
 *
 * Registration used to persist `taxId.replace(/[^\d]/g, '')` — every non-digit deleted, for every
 * country. For the thirteen countries whose identifier is numeric once formatting is removed, that
 * happened to be the correct canonical form and nothing was lost. For the other six it destroyed
 * information that cannot be reconstructed from what remains:
 *
 *   MX  the RFC's leading letters and its check pair       `DEM010203AB5` → `0102035`
 *   CL  the `K` check character                            `76.086.428-K` → `76086428`
 *   VE  the type letter that separates J/G/P from V/E      `J-…` and `V-…` → the same digits
 *   GT  the `K` check character
 *   NI  the leading letter of the RUC
 *   PA  the segment structure of a composite RUC
 *
 * A migration cannot invent those characters back. So rather than leave corrupt values looking
 * authoritative, every affected row is marked unverified: `tax_id_verified_at` is NULL, which the
 * application treats as "ask this tenant to confirm their fiscal identifier before issuing".
 * Rows from the thirteen lossless countries are stamped as verified, because for them the stored
 * value already equals the canonical form the new code computes.
 */
export class TaxpayerKindAndFiscalProfile1788100000000 implements MigrationInterface {
  name = 'TaxpayerKindAndFiscalProfile1788100000000';

  /** Countries whose canonical form is digits-only, so the old strip was lossless. */
  private static readonly LOSSLESS_COUNTRIES = [
    'DO', 'US', 'CO', 'AR', 'BR', 'PE', 'EC', 'UY', 'PY', 'CR', 'BO', 'SV', 'HN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "taxpayer_kind" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "fiscal_profile" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "tax_id_verified_at" TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "pending_registrations" ADD COLUMN IF NOT EXISTS "taxpayer_kind" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_registrations" ADD COLUMN IF NOT EXISTS "fiscal_profile" jsonb`,
    );

    // Stamp the rows whose stored tax id is already canonical. Everything else stays NULL and is
    // surfaced to the tenant as "confirma tu identificador fiscal".
    await queryRunner.query(
      `
      UPDATE "organizations"
         SET "tax_id_verified_at" = now()
       WHERE "tax_id" IS NOT NULL
         AND "country" = ANY($1::text[])
      `,
      [TaxpayerKindAndFiscalProfile1788100000000.LOSSLESS_COUNTRIES],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "fiscal_profile"`);
    await queryRunner.query(`ALTER TABLE "pending_registrations" DROP COLUMN IF EXISTS "taxpayer_kind"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "tax_id_verified_at"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "fiscal_profile"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "taxpayer_kind"`);
  }
}
