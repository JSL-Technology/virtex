import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retire the two `fiscal_regions` columns the identity-document catalogue supersedes.
 *
 * ## `identity_document_config`
 *
 * A JSONB column shaped almost exactly like the catalogue this product needed —
 * `{ types: [{ code, label, regex, isCompany }] }` — present since the baseline schema, reseeded
 * on every boot, and read by nothing except a fallback strategy whose `validateTaxId` ended in
 * `return true`. It was unusable as a catalogue for four reasons:
 *
 *   - it held at most two entries per country (the company tax id, plus `individualDocument` where
 *     a profile declared one — two of nineteen did);
 *   - its `code` was derived from the human label by deleting every non-ASCII letter, so the
 *     Dominican Republic's was `RNCCDULA` and Costa Rica's `CDULAJURDICA`;
 *   - `isCompany` was a boolean, and so could not express an identifier that serves both — a
 *     Chilean RUT, a Colombian NIT, a Peruvian RUC;
 *   - it carried a regex and no check digit, making it strictly weaker than the arithmetic
 *     validation `tax-id-validators.ts` had already implemented for all nineteen markets.
 *
 * ## `tax_id_name`
 *
 * Stored the WORD — `'RNC'`, `'NIT'`, `'EIN'` — with a `DEFAULT 'Tax ID'` in English, so any
 * consumer rendering it showed untranslatable text. What a country calls its identifier is now an
 * attribute of the catalogue entry for that identifier, beside the pattern and checksum it belongs
 * with, as `label_key` (translated) or `label_verbatim` (deliberately not).
 *
 * Neither column has a reader left: `GET /localization/fiscal-regions` is consumed by one Angular
 * service with no callers, whose model declares four fields and neither of these.
 *
 * `down()` restores both columns but not their contents. That is honest rather than lossy by
 * accident: the data was regenerated from `COUNTRY_FISCAL_PROFILES` on every boot, so a rollback
 * followed by a boot on the previous code rebuilds it exactly.
 */
export class RetireFiscalRegionDocumentConfig1789005100000 implements MigrationInterface {
  name = 'RetireFiscalRegionDocumentConfig1789005100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fiscal_regions" DROP COLUMN IF EXISTS "identityDocumentConfig"`,
    );
    await queryRunner.query(`ALTER TABLE "fiscal_regions" DROP COLUMN IF EXISTS "tax_id_name"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fiscal_regions" ADD COLUMN IF NOT EXISTS "identityDocumentConfig" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "fiscal_regions" ADD COLUMN IF NOT EXISTS "tax_id_name" character varying NOT NULL DEFAULT 'Tax ID'`,
    );
  }
}
