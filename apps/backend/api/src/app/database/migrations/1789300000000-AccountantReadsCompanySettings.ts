import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The system Contador role reads the company's configuration and its approval policies.
 *
 * Reading default accounts, accounting policies, numbering, outgoing mail, single sign-on,
 * integrations or approval policies used to require the permission to change them, so an
 * accountant could not see the configuration the books depend on. The read permissions are new
 * (`settings:view_company`, `workflows:view`); new tenants get them from `roles.config`, and this
 * brings the existing system roles in line. Roles that may edit already read through
 * `IMPLIED_PERMISSIONS`, and custom roles are left as their owners made them.
 */
export class AccountantReadsCompanySettings1789300000000 implements MigrationInterface {
  name = 'AccountantReadsCompanySettings1789300000000';

  private static readonly GRANTED = ['settings:view_company', 'workflows:view'] as const;

  public async up(q: QueryRunner): Promise<void> {
    for (const permission of AccountantReadsCompanySettings1789300000000.GRANTED) {
      await q.query(
        `
        UPDATE "roles"
           SET "permissions" = CASE WHEN coalesce("permissions", '') = '' THEN $1
                                    ELSE "permissions" || ',' || $1 END
         WHERE "name" = 'ACCOUNTANT' AND "is_system_role" = true
           AND NOT ($1 = ANY (string_to_array(coalesce("permissions", ''), ',')))
        `,
        [permission],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const permission of AccountantReadsCompanySettings1789300000000.GRANTED) {
      await q.query(
        `
        UPDATE "roles"
           SET "permissions" = array_to_string(array_remove(string_to_array("permissions", ','), $1), ',')
         WHERE "name" = 'ACCOUNTANT' AND "is_system_role" = true
        `,
        [permission],
      );
    }
  }
}
