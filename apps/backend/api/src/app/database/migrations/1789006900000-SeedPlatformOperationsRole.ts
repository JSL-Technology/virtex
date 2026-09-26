import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the one role that can actually hold the platform permissions this audit introduced.
 *
 * ## The hole this closes
 *
 * `platform:extensions:publish`, `platform:extensions:revoke`,
 * `platform:extensions:run_arbitrary_code`, `platform:analytics:rebuild_view` and
 * `platform:analytics:refresh_view` guard the extensions catalogue and the shared analytical
 * view — see `platform-permissions.ts` for why those routes cannot be guarded by an ordinary
 * tenant permission. `RolesService` refuses, on both paths (`assertAssignablePermissions` and
 * `assertCanAssignRole`), to let any tenant create or hold a role carrying one of these: that is
 * correct, and it is also the entire supply of them. Before this migration, NOTHING in the
 * database carried a platform permission — no migration, no seeder, no role — so after deploying
 * the guarded routes, no principal could publish or revoke an extension, or refresh or rebuild
 * the analytical view, through the API. The feature and its guard both shipped; only the key that
 * opens the guard did not.
 *
 * ## What this does, and does not, do
 *
 * It inserts the role — `organization_id IS NULL`, the same shape `permissionsFor` already
 * treats as "applies everywhere" for a support/operations principal — carrying all five
 * permissions. It does NOT assign that role to anyone. Handing it to a person is a deliberate,
 * auditable operational act (`INSERT INTO user_roles ...`, by someone with database access, as
 * part of a rollout), not something a migration should decide on an operator's behalf. That
 * matches the role's own name and intent: seeded, not self-assignable.
 *
 * Idempotent by name-and-null-organization, so re-running this migration, or a future one that
 * seeds a related platform role, cannot create a duplicate.
 */
export class SeedPlatformOperationsRole1789006900000 implements MigrationInterface {
  name = 'SeedPlatformOperationsRole1789006900000';

  private static readonly ROLE_NAME = 'Platform Operations';

  // A literal snapshot, not an import of `PLATFORM_PERMISSIONS`: a migration has to keep
  // producing the same result years from now, on a database created from scratch, regardless of
  // what that constant later grows to hold.
  private static readonly PERMISSIONS = [
    'platform:extensions:publish',
    'platform:extensions:revoke',
    'platform:extensions:run_arbitrary_code',
    'platform:analytics:rebuild_view',
    'platform:analytics:refresh_view',
  ].join(',');

  public async up(queryRunner: QueryRunner): Promise<void> {
    // $1 is cast explicitly on both appearances: left bare, Postgres deduces it as `text` from
    // the SELECT list and as `character varying` from the comparison against "roles"."name" —
    // two different types for one placeholder, which it refuses ("inconsistent types deduced for
    // parameter $1"). Casting removes the ambiguity instead of relying on which occurrence it
    // happens to check first.
    await queryRunner.query(
      `INSERT INTO "roles" ("name", "description", "permissions", "is_system_role", "organization_id")
       SELECT $1::character varying, $2::text, $3::text, true, NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM "roles" WHERE "organization_id" IS NULL AND "name" = $1::character varying
       )`,
      [
        SeedPlatformOperationsRole1789006900000.ROLE_NAME,
        'Publishes and revokes catalogue extensions, and rebuilds or refreshes the shared ' +
          'analytical view. Platform-wide; assign only to operators, never to a tenant role.',
        SeedPlatformOperationsRole1789006900000.PERMISSIONS,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "roles" WHERE "organization_id" IS NULL AND "name" = $1`,
      [SeedPlatformOperationsRole1789006900000.ROLE_NAME],
    );
  }
}
