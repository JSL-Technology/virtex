import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A supplier bill's document date is a calendar date, not an instant.
 *
 * ## What was wrong
 *
 * `vendor_bills.date` and `vendor_bills."dueDate"` were `timestamp without time zone`, because the
 * entity declared them `@Column() date: Date` and reflect-metadata resolves a `Date` property to
 * `timestamp`. Nothing ever set a time on them — a bill is dated the 14th, not the 14th at some
 * hour — so every row held midnight, and the API served `2026-09-14T00:00:00.000Z`.
 *
 * The browser then did the only thing it could with an instant: rendered it in the tenant's zone.
 * For a Dominican tenant that is UTC−4, so midnight on the 14th became 20:00 on the 13th, and
 * **every supplier bill in the product displayed the day before its own date** — on the document,
 * in the list, in the ageing buckets and on the DGII 606, where the document date is what the tax
 * authority matches against the supplier's own filing.
 *
 * The sibling column got this right: `vendor_bills.paid_at` is already `date`, and so are the two
 * date columns on the sales invoice table, which is why sales documents were off by one only in the
 * rendering layer while purchases were off by one in the data as well.
 *
 * ## What this does
 *
 * Converts both columns to `date`. The cast is lossless here and the migration proves it rather
 * than assuming it: it refuses to run if any row carries a non-zero time, because that would mean
 * something really was storing an instant and dropping it silently would lose information.
 *
 * Reversing restores `timestamp`, which is exact — midnight is what the values were.
 */
export class VendorBillDocumentDates1789004800000 implements MigrationInterface {
  name = 'VendorBillDocumentDates1789004800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const present = await queryRunner.query(
      `SELECT to_regclass('public.vendor_bills') IS NOT NULL AS present`,
    );
    if (!present?.[0]?.present) return;

    const [{ withtime }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS withtime
         FROM "vendor_bills"
        WHERE "date"::time <> '00:00:00' OR "dueDate"::time <> '00:00:00'`,
    );
    if (withtime > 0) {
      throw new Error(
        `VendorBillDocumentDates: ${withtime} vendor bill(s) carry a time component. ` +
          `These columns are document dates; converting them would discard a real value. ` +
          `Inspect those rows before re-running.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "vendor_bills" ALTER COLUMN "date" TYPE date USING "date"::date`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_bills" ALTER COLUMN "dueDate" TYPE date USING "dueDate"::date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const present = await queryRunner.query(
      `SELECT to_regclass('public.vendor_bills') IS NOT NULL AS present`,
    );
    if (!present?.[0]?.present) return;

    await queryRunner.query(
      `ALTER TABLE "vendor_bills" ALTER COLUMN "date" TYPE timestamp USING "date"::timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_bills" ALTER COLUMN "dueDate" TYPE timestamp USING "dueDate"::timestamp`,
    );
  }
}
