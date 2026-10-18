import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "We are not in your country yet — let me know" (QA A-13).
 *
 * A visitor from a market the product does not serve was bounced to the sign-in page with no
 * explanation. The signup now says so and offers to tell them when it opens there; this table is
 * where that request is kept. Deliberately small: who asked, for which country, in which language
 * to write back, and when. One row per address and country — asking twice is the same request.
 */
export class MarketWaitlist1789010220000 implements MigrationInterface {
  name = 'MarketWaitlist1789010220000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "market_waitlist" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(254) NOT NULL,
        "country_code" character varying(2) NOT NULL,
        "language" character varying(5),
        "ip_address" character varying(64),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_market_waitlist" PRIMARY KEY ("id")
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_market_waitlist_email_country" ON "market_waitlist" ("email", "country_code")`,
    );
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "market_waitlist" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "market_waitlist"`);
  }
}
