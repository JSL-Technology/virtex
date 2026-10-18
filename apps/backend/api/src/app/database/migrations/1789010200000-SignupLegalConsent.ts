import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Signup consent, recorded (QA C-07).
 *
 * The signup form had a "I agree to the Terms and the Privacy policy" box that was not required,
 * and the payload of `POST /auth/register-checkout` carried no trace of it: an account could be
 * created without accepting anything, and one created after ticking the box could not prove it.
 *
 *   - `pending_registrations` gains the acceptance as it was given — which edition of each
 *     document, when, and from which address — because the account does not exist yet when the
 *     person accepts; payment comes between the two.
 *   - `legal_acceptances` is where it lives once the account is materialised: one row per
 *     document accepted, per person. A row and not columns on `users`, because a person accepts
 *     a NEW edition later and the earlier acceptance must survive alongside it, and because one
 *     identity can sign up several companies — each signup is its own acceptance.
 *
 * Nothing is backfilled. Accounts created before this migration never accepted anything the
 * product can prove, and inventing an acceptance for them would be the one thing worse than
 * having none.
 */
export class SignupLegalConsent1789010200000 implements MigrationInterface {
  name = 'SignupLegalConsent1789010200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "pending_registrations"
        ADD COLUMN IF NOT EXISTS "terms_version" character varying(32),
        ADD COLUMN IF NOT EXISTS "privacy_version" character varying(32),
        ADD COLUMN IF NOT EXISTS "terms_accepted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "terms_accepted_ip" character varying(64),
        ADD COLUMN IF NOT EXISTS "terms_accepted_user_agent" character varying(255)
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "legal_acceptances" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "organization_id" uuid,
        "document" character varying(16) NOT NULL,
        "version" character varying(32) NOT NULL,
        "accepted_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ip_address" character varying(64),
        "user_agent" character varying(255),
        "source" character varying(32) NOT NULL DEFAULT 'signup',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_legal_acceptances" PRIMARY KEY ("id"),
        CONSTRAINT "FK_legal_acceptances_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_legal_acceptances_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_legal_acceptances_user_document" ON "legal_acceptances" ("user_id", "document")`,
    );

    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "legal_acceptances" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "legal_acceptances"`);
    await q.query(`
      ALTER TABLE "pending_registrations"
        DROP COLUMN IF EXISTS "terms_accepted_user_agent",
        DROP COLUMN IF EXISTS "terms_accepted_ip",
        DROP COLUMN IF EXISTS "terms_accepted_at",
        DROP COLUMN IF EXISTS "privacy_version",
        DROP COLUMN IF EXISTS "terms_version"
    `);
  }
}
