import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The system Contador role reads analytical dimensions (QA R3-M04).
 *
 * The journal-entry form and the financial statements load the tenant's dimensions, and an
 * accountant met a 403 opening either. New tenants get the permission from `roles.config`; this
 * brings the existing system roles in line. Custom roles are left as their owners made them.
 */
export class AccountantReadsDimensions1789240000000 implements MigrationInterface {
  name = 'AccountantReadsDimensions1789240000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "roles"
         SET "permissions" = CASE WHEN coalesce("permissions", '') = '' THEN 'dimensions:view'
                                  ELSE "permissions" || ',dimensions:view' END
       WHERE "name" = 'ACCOUNTANT' AND "is_system_role" = true
         AND NOT ('dimensions:view' = ANY (string_to_array(coalesce("permissions", ''), ',')))
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "roles"
         SET "permissions" = array_to_string(array_remove(string_to_array("permissions", ','), 'dimensions:view'), ',')
       WHERE "name" = 'ACCOUNTANT' AND "is_system_role" = true
    `);
  }
}
