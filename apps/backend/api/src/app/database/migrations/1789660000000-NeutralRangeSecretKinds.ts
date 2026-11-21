import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The material an authorised range carries, named for what it IS
 * (docs/ARQUITECTURA_MERCADOS.md, fase 7).
 *
 * `fiscal_document_ranges.secret_kind` held `CAF_XML` and `DIAN_TECHNICAL_KEY`: one authority's
 * file name and another authority's own name, in a column every market shares. What they have in
 * common is what they are — a file of folios the authority authorised and signed, and a key the
 * authority issued with the resolution — and a third market that issues either of them reuses the
 * value instead of adding its own.
 *
 * | Before | After |
 * |---|---|
 * | `CAF_XML` | `AUTHORISED_FOLIOS` |
 * | `DIAN_TECHNICAL_KEY` | `TECHNICAL_KEY` |
 *
 * The column is a `varchar`, so this is the data and nothing else; the encrypted material itself is
 * untouched.
 */
export class NeutralRangeSecretKinds1789660000000 implements MigrationInterface {
  name = 'NeutralRangeSecretKinds1789660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "fiscal_document_ranges" SET "secret_kind" = 'AUTHORISED_FOLIOS' WHERE "secret_kind" = 'CAF_XML'`,
    );
    await queryRunner.query(
      `UPDATE "fiscal_document_ranges" SET "secret_kind" = 'TECHNICAL_KEY' WHERE "secret_kind" = 'DIAN_TECHNICAL_KEY'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "fiscal_document_ranges" SET "secret_kind" = 'CAF_XML' WHERE "secret_kind" = 'AUTHORISED_FOLIOS'`,
    );
    await queryRunner.query(
      `UPDATE "fiscal_document_ranges" SET "secret_kind" = 'DIAN_TECHNICAL_KEY' WHERE "secret_kind" = 'TECHNICAL_KEY'`,
    );
  }
}
