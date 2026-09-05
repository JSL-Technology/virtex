import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A currency pair does not have one rate on a day, and nothing recorded which one was used.
 *
 * ## What the table could not express
 *
 * `exchange_rate` held one row per pair per day, with no type and no source. Three consequences,
 * all of them in the books rather than the schema:
 *
 * 1. **An official rate and a market rate overwrote each other.** Colombia's TRM, Mexico's DOF FIX
 *    and the Dominican Republic's DGII rate are each the mandatory accounting rate in their
 *    jurisdiction and each differs from the interbank mid a commercial provider quotes. Holding
 *    both for the same day was impossible: the unique index on `(from, to, date)` forbade it.
 * 2. **Nothing said where a figure came from.** Every rate in the table was fetched from one
 *    market-data provider, and an auditor asked to substantiate a foreign-currency posting has no
 *    way to establish that from the data.
 * 3. **Nothing said who entered one by hand,** because nothing could be entered by hand.
 *
 * ## The conversion
 *
 * Existing rows are market quotes from Xe — that was the only writer — so they are typed `MARKET`
 * and sourced `XE`. Typing them `OFFICIAL` would be the more convenient default and the wrong one:
 * it would let an interbank mid satisfy a lookup for the rate a tax authority mandates.
 *
 * The old `(from, to, date)` unique index is replaced by `(from, to, date, rate_type)`. Widening a
 * unique index never rejects rows the narrower one accepted, so the conversion cannot fail on data.
 *
 * `organization_settings.exchange_rate_type` is the tenant's side of the same fact: which of the
 * published rates its books are kept at. It defaults to `OFFICIAL` because that is what the law
 * requires in most of the markets this product serves, and a tenant that genuinely books at the
 * market rate is opting out of the stricter default rather than into it. The resolver falls back to
 * a market quote with a warning when no official one is on file, so the default cannot leave a
 * tenant unable to post.
 */
export class ExchangeRateTypeAndSource1788900000000 implements MigrationInterface {
  name = 'ExchangeRateTypeAndSource1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exchange_rate_rate_type_enum') THEN
          CREATE TYPE "public"."exchange_rate_rate_type_enum"
            AS ENUM ('OFFICIAL', 'MARKET', 'BUY', 'SELL');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "exchange_rate"
        ADD COLUMN IF NOT EXISTS "rate_type" "public"."exchange_rate_rate_type_enum"
          NOT NULL DEFAULT 'OFFICIAL',
        ADD COLUMN IF NOT EXISTS "source" character varying(32) NOT NULL DEFAULT 'MANUAL',
        ADD COLUMN IF NOT EXISTS "recorded_by_user_id" uuid
    `);

    // Everything already in the table came from the scheduled Xe refresh, which publishes an
    // interbank mid. The column default is OFFICIAL for rows entered from here on; the rows that
    // predate the column are what they actually are.
    await queryRunner.query(`
      UPDATE "exchange_rate"
      SET "rate_type" = 'MARKET', "source" = 'XE'
      WHERE "source" = 'MANUAL' AND "recorded_by_user_id" IS NULL
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_exchange_rate_pair_date"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_exchange_rate_pair_date_type"
      ON "exchange_rate" ("fromCurrency", "toCurrency", "date", "rate_type")
    `);
    // The lookup is always "this pair, this type, on or before this date, newest first". Without a
    // covering index that is a sequential scan of every rate ever published, on the hot path of
    // every foreign-currency posting.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_exchange_rate_lookup"
      ON "exchange_rate" ("fromCurrency", "toCurrency", "rate_type", "date")
    `);

    // ── The tenant's side: which published rate its books are kept at ────────
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'organization_settings_exchange_rate_type_enum'
        ) THEN
          CREATE TYPE "public"."organization_settings_exchange_rate_type_enum"
            AS ENUM ('OFFICIAL', 'MARKET', 'BUY', 'SELL');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "exchange_rate_type"
          "public"."organization_settings_exchange_rate_type_enum" NOT NULL DEFAULT 'OFFICIAL'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "exchange_rate_type"
    `);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."organization_settings_exchange_rate_type_enum"`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_exchange_rate_lookup"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_exchange_rate_pair_date_type"`);

    // Reverting to one row per pair per day means choosing which type survives. Official rates are
    // the ones a posting is legally obliged to have used, so they win; the rest are dropped rather
    // than silently retyped.
    await queryRunner.query(`
      DELETE FROM "exchange_rate" a
      USING "exchange_rate" b
      WHERE a."fromCurrency" = b."fromCurrency"
        AND a."toCurrency" = b."toCurrency"
        AND a."date" = b."date"
        AND a."id" <> b."id"
        AND (a."rate_type" <> 'OFFICIAL' OR (b."rate_type" = 'OFFICIAL' AND a."id" > b."id"))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_exchange_rate_pair_date"
      ON "exchange_rate" ("fromCurrency", "toCurrency", "date")
    `);

    await queryRunner.query(`
      ALTER TABLE "exchange_rate"
        DROP COLUMN IF EXISTS "recorded_by_user_id",
        DROP COLUMN IF EXISTS "source",
        DROP COLUMN IF EXISTS "rate_type"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."exchange_rate_rate_type_enum"`);
  }
}
