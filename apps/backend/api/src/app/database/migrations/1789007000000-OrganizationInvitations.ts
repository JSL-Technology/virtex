import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Invitations an existing account has to accept, and memberships a tenant can suspend.
 *
 * ## Why
 *
 * An identity is global: one person, one account, however many tenants they work for. Two things
 * followed from that and were wrong.
 *
 *   1. Inviting an existing account wrote its `user_organizations` row at once. Membership is what
 *      the administration endpoints authorise against, so any tenant could make any account on the
 *      platform "one of its members" by typing an email address. `organization_invitations` makes
 *      that a pending request that only the addressee can accept, from their own session.
 *
 *   2. The only way a tenant could stop somebody acting inside it was to block the ACCOUNT — which
 *      cut the person off from every other tenant too. `user_organizations.suspended_at` is the
 *      tenant-local switch: it removes access to that one tenant and nothing else.
 *
 * ## Isolation
 *
 * `user_organizations` loses its tenant policy here, and is classified cross-tenant instead. It
 * answers "which tenants may this PERSON act in", and it is read on the authentication path —
 * before any tenant is set — to build the list the tenant switch and `ActiveTenantGuard` authorise
 * against. Under the policy, a connection as `virtex_app` saw only the row of whichever tenant
 * happened to be set (none, at sign-in), so every membership but the home one was invisible: the
 * multi-tenant model worked only for connections that bypassed RLS. Every query on it filters by
 * `user_id` or by `organization_id` explicitly.
 *
 * `organization_invitations` is read by its addressee from whichever tenant they are acting in, so a
 * tenant policy would hide it from the one person who must see it. It is classified cross-tenant
 * (`tenant-table-classification.ts`), and every query filters by organization or addressee.
 */
export class OrganizationInvitations1789007000000 implements MigrationInterface {
  name = 'OrganizationInvitations1789007000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_invitation_status') THEN
          CREATE TYPE "organization_invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');
        END IF;
      END
      $$;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "organization_invitations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        "invited_by_id" uuid NULL,
        "status" "organization_invitation_status" NOT NULL DEFAULT 'PENDING',
        "expires_at" timestamptz NOT NULL,
        "responded_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_organization_invitations_org" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_organization_invitations_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_organization_invitations_role" FOREIGN KEY ("role_id")
          REFERENCES "roles"("id") ON DELETE CASCADE
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_organization_invitations_user_status"
        ON "organization_invitations" ("user_id", "status")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_organization_invitations_org_status"
        ON "organization_invitations" ("organization_id", "status")
    `);
    // At most one live invitation per person and tenant: re-inviting refreshes it instead of
    // stacking requests the addressee would have to answer one by one.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_organization_invitations_pending"
        ON "organization_invitations" ("organization_id", "user_id")
        WHERE "status" = 'PENDING'
    `);

    await q.query(`
      ALTER TABLE "user_organizations"
        ADD COLUMN IF NOT EXISTS "suspended_at" timestamptz NULL
    `);

    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "user_organizations"`);
    await q.query(`ALTER TABLE "user_organizations" NO FORCE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "user_organizations" DISABLE ROW LEVEL SECURITY`);

    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_invitations" TO virtex_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "user_organizations" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    await q.query(`ALTER TABLE "user_organizations" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "user_organizations" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "user_organizations"
        USING ("organization_id" = ${setting}::uuid)
        WITH CHECK ("organization_id" = ${setting}::uuid)
    `);
    await q.query(`ALTER TABLE "user_organizations" DROP COLUMN IF EXISTS "suspended_at"`);
    await q.query(`DROP TABLE IF EXISTS "organization_invitations"`);
    await q.query(`DROP TYPE IF EXISTS "organization_invitation_status"`);
  }
}
