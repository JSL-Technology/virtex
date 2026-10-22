import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * External AI agents (Claude, ChatGPT, an in-house agent) reaching the ERP over MCP, as the person
 * who authorised them — OAuth 2.1 with PKCE, nothing broader than that person's own permissions.
 *
 *  - `mcp_oauth_clients`: agents registered dynamically (RFC 7591). A name and its redirect
 *    addresses; no tenant data, no secret (public clients, PKCE only).
 *  - `mcp_oauth_codes`: one-time authorisation codes, a minute long, bound to the client, the
 *    redirect address and the PKCE challenge. Only their hash is kept.
 *  - `mcp_oauth_tokens`: access tokens (an hour) and rotating refresh tokens (30 days), per person,
 *    company and client. Only their hash is kept; revoking one revokes its family.
 *  - `ai_pending_actions.channel`: whether a draft was proposed in the assistant or by an external
 *    agent — the confirmed record says which.
 *
 * Codes and tokens are read by their hash before any tenant is known (like `refresh_tokens`), so
 * they are classified cross-tenant; every query names the hash, the person or the company.
 */
export class McpOAuth1789220000000 implements MigrationInterface {
  name = 'McpOAuth1789220000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "mcp_oauth_clients" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "client_id" varchar(64) NOT NULL,
        "name" varchar(200) NOT NULL,
        "redirect_uris" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mcp_oauth_clients" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_mcp_oauth_clients_client_id" UNIQUE ("client_id")
      )
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "mcp_oauth_codes" (
        "code_hash" char(64) NOT NULL,
        "client_id" varchar(64) NOT NULL,
        "user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "redirect_uri" varchar(2000) NOT NULL,
        "code_challenge" varchar(128) NOT NULL,
        "scope" varchar(200) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mcp_oauth_codes" PRIMARY KEY ("code_hash"),
        CONSTRAINT "FK_mcp_oauth_codes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_mcp_oauth_codes_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "mcp_oauth_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "token_hash" char(64) NOT NULL,
        "kind" varchar(8) NOT NULL,
        "family_id" uuid NOT NULL,
        "client_id" varchar(64) NOT NULL,
        "user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "scope" varchar(200) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz NULL,
        "last_used_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mcp_oauth_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_mcp_oauth_tokens_hash" UNIQUE ("token_hash"),
        CONSTRAINT "CHK_mcp_oauth_tokens_kind" CHECK ("kind" IN ('ACCESS', 'REFRESH')),
        CONSTRAINT "FK_mcp_oauth_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_mcp_oauth_tokens_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_mcp_oauth_tokens_user_org" ON "mcp_oauth_tokens" ("user_id", "organization_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_mcp_oauth_tokens_family" ON "mcp_oauth_tokens" ("family_id")`);
    await q.query(`ALTER TABLE "ai_pending_actions" ADD COLUMN IF NOT EXISTS "channel" varchar(16) NOT NULL DEFAULT 'COPILOT'`);
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_ai_pending_actions_channel') THEN
          ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "CHK_ai_pending_actions_channel" CHECK ("channel" IN ('COPILOT', 'MCP'));
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "mcp_oauth_clients", "mcp_oauth_codes", "mcp_oauth_tokens" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ai_pending_actions" DROP CONSTRAINT IF EXISTS "CHK_ai_pending_actions_channel"`);
    await q.query(`ALTER TABLE "ai_pending_actions" DROP COLUMN IF EXISTS "channel"`);
    await q.query(`DROP TABLE IF EXISTS "mcp_oauth_tokens"`);
    await q.query(`DROP TABLE IF EXISTS "mcp_oauth_codes"`);
    await q.query(`DROP TABLE IF EXISTS "mcp_oauth_clients"`);
  }
}
