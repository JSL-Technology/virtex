import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The enum values the invoicing overhaul needs, added ahead of the migration that uses them.
 *
 * PostgreSQL refuses to use an enum value in the same transaction that created it —
 * `unsafe use of new value ... New enum values must be committed before they can be used`. TypeORM
 * runs each migration in its own transaction, so an `ADD VALUE` and its first use have to live in
 * different files. Splitting them is the whole purpose of this migration; it does nothing else.
 */
export class InvoicingEnumValues1788490000000 implements MigrationInterface {
  name = 'InvoicingEnumValues1788490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A quote is not an invoice, and must not draw its number from the invoice sequence: doing so
    // consumed invoice numbers for documents that may never be invoiced, leaving gaps a taxpayer
    // has to explain.
    await queryRunner.query(
      `ALTER TYPE "public"."document_sequences_type_enum" ADD VALUE IF NOT EXISTS 'QUOTE'`,
    );

    // Debit notes join the sales document types.
    await queryRunner.query(
      `ALTER TYPE "public"."invoices_type_enum" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot drop an individual enum value. The added members are inert when unused.
  }
}
