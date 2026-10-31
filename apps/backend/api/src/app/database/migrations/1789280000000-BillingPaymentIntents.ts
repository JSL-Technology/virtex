import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subscription charges through a Dominican acquirer (Azul).
 *
 * Stripe keeps the subscription, its invoices and the card on its side; a local acquirer charges
 * one payment at a time — the first through its hosted payment page, the renewals against a card
 * token it keeps (DataVault). Each charge is a row here: what was asked, what the acquirer answered,
 * and the token the next renewal charges. Platform-level, like `pending_registrations`: the first
 * charge happens at signup, before the company exists.
 */
export class BillingPaymentIntents1789280000000 implements MigrationInterface {
  name = 'BillingPaymentIntents1789280000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "billing_payment_intents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar(16) NOT NULL,
        "kind" varchar(16) NOT NULL,
        "order_number" varchar(15) NOT NULL,
        "pending_registration_id" uuid NULL,
        "organization_id" uuid NULL,
        "email" varchar(255) NULL,
        "plan_slug" varchar(64) NOT NULL,
        "billing_period" varchar(16) NOT NULL DEFAULT 'monthly',
        "currency" char(3) NOT NULL,
        "amount_minor" bigint NOT NULL,
        "tax_minor" bigint NOT NULL DEFAULT 0,
        "status" varchar(16) NOT NULL DEFAULT 'PENDING',
        "success_url" text NULL,
        "cancel_url" text NULL,
        "authorization_code" varchar(32) NULL,
        "provider_order_id" varchar(64) NULL,
        "rrn" varchar(64) NULL,
        "card_token" text NULL,
        "card_last4" varchar(4) NULL,
        "card_brand" varchar(32) NULL,
        "response" jsonb NULL,
        "period_end" timestamptz NULL,
        "invoiced_at" timestamptz NULL,
        "platform_invoice_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_payment_intents" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_payment_intents_order" UNIQUE ("provider", "order_number"),
        CONSTRAINT "CHK_billing_payment_intents_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'VOIDED')),
        CONSTRAINT "CHK_billing_payment_intents_kind" CHECK ("kind" IN ('registration', 'organization', 'renewal')),
        -- The PLATFORM's record of what it charged: it outlives the customer company (its own books
        -- and e-CF refer to it), so erasing the company clears the link instead of the charge.
        CONSTRAINT "FK_billing_payment_intents_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE SET NULL
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_payment_intents_org" ON "billing_payment_intents" ("organization_id", "created_at")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_payment_intents_uninvoiced" ON "billing_payment_intents" ("status") WHERE "invoiced_at" IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "billing_payment_intents"`);
  }
}
