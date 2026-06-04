import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payment-first signup support:
 *  - `pending_registrations` holds a fully-validated signup awaiting payment, so
 *    the account (org + user) is only created once Stripe confirms the checkout.
 *  - `saas_plans.trial_period_days` enables optional per-plan trials/promotions
 *    without code changes (null/0 = charge immediately).
 *  - `organizations.plan_id` gains a real FK to `saas_plans` to match the entity
 *    relation used for plan/limit enforcement.
 */
export class PaymentFirstSignup1749081600000 implements MigrationInterface {
  name = 'PaymentFirstSignup1749081600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pending_registrations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "firstName" character varying NOT NULL,
        "lastName" character varying NOT NULL,
        "phone" character varying,
        "phone_verified" boolean NOT NULL DEFAULT false,
        "password_hash" character varying NOT NULL,
        "organization_name" character varying NOT NULL,
        "tax_id" character varying,
        "fiscal_region_id" character varying,
        "industry" character varying,
        "company_size" character varying,
        "address" character varying,
        "plan_slug" character varying NOT NULL,
        "stripe_session_id" character varying,
        "status" character varying NOT NULL DEFAULT 'pending',
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pending_registrations" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pending_registrations_email" ON "pending_registrations" ("email")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pending_registrations_session" ON "pending_registrations" ("stripe_session_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "saas_plans" ADD COLUMN IF NOT EXISTS "trial_period_days" integer`,
    );

    // Add the FK on organizations.plan_id (the column already exists). Guarded so
    // re-running is safe and orphan plan_id values don't block the migration.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'FK_organizations_plan' AND table_name = 'organizations'
        ) THEN
          ALTER TABLE "organizations"
            ADD CONSTRAINT "FK_organizations_plan"
            FOREIGN KEY ("plan_id") REFERENCES "saas_plans" ("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "FK_organizations_plan"`);
    await queryRunner.query(`ALTER TABLE "saas_plans" DROP COLUMN IF EXISTS "trial_period_days"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pending_registrations_session"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pending_registrations_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pending_registrations"`);
  }
}
