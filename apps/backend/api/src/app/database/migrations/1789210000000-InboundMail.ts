import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Addresses a company receives mail at, and the mail it received.
 *
 *  - `inbound_mailboxes`: one address per company and purpose (`bills+<token>@…` for supplier
 *    bills, `orders+<token>@…` for customer orders). The token is the only thing in the address
 *    that names the company, so it is long, random and rotatable; an optional list of senders
 *    narrows who may write to it.
 *  - `inbound_messages`: each message received, what happened to it, and what it became.
 *  - `inbound_mailbox_by_token(token)`: the one read that must happen before the tenant is known
 *    (the webhook has only the address). A narrow SECURITY DEFINER function — one row, by exact
 *    token, active mailboxes only — owned by `virtex_inbound_lookup`, a role nobody logs in as,
 *    which alone has a policy to read the mailboxes of every tenant. The table keeps FORCE ROW
 *    LEVEL SECURITY for everyone else, its owner included.
 */
export class InboundMail1789210000000 implements MigrationInterface {
  name = 'InboundMail1789210000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "inbound_mailboxes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "purpose" varchar(16) NOT NULL,
        "token" varchar(64) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "allowed_senders" jsonb NOT NULL DEFAULT '[]',
        "created_by_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inbound_mailboxes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_inbound_mailboxes_token" UNIQUE ("token"),
        CONSTRAINT "UQ_inbound_mailboxes_org_purpose" UNIQUE ("organization_id", "purpose"),
        CONSTRAINT "CHK_inbound_mailboxes_purpose" CHECK ("purpose" IN ('BILLS', 'ORDERS')),
        CONSTRAINT "FK_inbound_mailboxes_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "inbound_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "mailbox_id" uuid NOT NULL,
        "purpose" varchar(16) NOT NULL,
        "message_id" varchar(255) NOT NULL,
        "from_address" varchar(320) NOT NULL,
        "from_name" varchar(200) NULL,
        "subject" varchar(500) NOT NULL DEFAULT '',
        "body_text" text NOT NULL DEFAULT '',
        "attachments" jsonb NOT NULL DEFAULT '[]',
        "status" varchar(16) NOT NULL DEFAULT 'RECEIVED',
        "reason" varchar(120) NULL,
        "records" jsonb NOT NULL DEFAULT '[]',
        "review" jsonb NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz NULL,
        "resolved_by_user_id" uuid NULL,
        CONSTRAINT "PK_inbound_messages" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_inbound_messages_org_message" UNIQUE ("organization_id", "message_id"),
        CONSTRAINT "CHK_inbound_messages_status" CHECK ("status" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'NEEDS_REVIEW', 'REJECTED', 'FAILED', 'DISMISSED')),
        CONSTRAINT "FK_inbound_messages_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inbound_messages_mailbox" FOREIGN KEY ("mailbox_id")
          REFERENCES "inbound_mailboxes"("id") ON DELETE CASCADE
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_inbound_messages_org_purpose_received" ON "inbound_messages" ("organization_id", "purpose", "received_at")`,
    );
    for (const table of ['inbound_mailboxes', 'inbound_messages']) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
      `);
    }
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_inbound_lookup') THEN
          CREATE ROLE virtex_inbound_lookup NOLOGIN NOBYPASSRLS;
        END IF;
      END
      $$;
    `);
    await q.query(`GRANT USAGE ON SCHEMA public TO virtex_inbound_lookup`);
    await q.query(`GRANT SELECT ON "inbound_mailboxes" TO virtex_inbound_lookup`);
    await q.query(`DROP POLICY IF EXISTS inbound_lookup ON "inbound_mailboxes"`);
    await q.query(`CREATE POLICY inbound_lookup ON "inbound_mailboxes" FOR SELECT TO virtex_inbound_lookup USING (true)`);
    await q.query(`
      CREATE OR REPLACE FUNCTION inbound_mailbox_by_token(lookup_token text)
      RETURNS TABLE (mailbox_id uuid, organization_id uuid, purpose varchar, allowed_senders jsonb)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT m.id, m.organization_id, m.purpose, m.allowed_senders
          FROM inbound_mailboxes m
         WHERE m.token = lookup_token AND m.active
         LIMIT 1
      $$
    `);
    await q.query(`ALTER FUNCTION inbound_mailbox_by_token(text) OWNER TO virtex_inbound_lookup`);
    await q.query(`REVOKE ALL ON FUNCTION inbound_mailbox_by_token(text) FROM PUBLIC`);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "inbound_mailboxes", "inbound_messages" TO virtex_app;
          GRANT EXECUTE ON FUNCTION inbound_mailbox_by_token(text) TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION IF EXISTS inbound_mailbox_by_token(text)`);
    // The role stays: dropping one that may hold grants elsewhere fails, and without the function it can do nothing.
    await q.query(`DROP TABLE IF EXISTS "inbound_messages"`);
    await q.query(`DROP TABLE IF EXISTS "inbound_mailboxes"`);
  }
}
