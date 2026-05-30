import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddOrganizationIdToRoles1780183200000 implements MigrationInterface {
  name = 'AddOrganizationIdToRoles1780183200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rolesTable = await queryRunner.getTable('roles');
    const hasOrganizationId = rolesTable?.findColumnByName('organization_id');

    if (!hasOrganizationId) {
      await queryRunner.addColumn(
        'roles',
        new TableColumn({
          name: 'organization_id',
          type: 'varchar',
          isNullable: true,
        }),
      );
    }

    await queryRunner.query(`
      WITH role_organizations AS (
        SELECT
          ur.role_id,
          MIN(u.organization_id) AS organization_id,
          COUNT(DISTINCT u.organization_id) AS organization_count
        FROM user_roles ur
        INNER JOIN users u ON u.id = ur.user_id
        WHERE u.organization_id IS NOT NULL
        GROUP BY ur.role_id
        HAVING COUNT(DISTINCT u.organization_id) = 1
      )
      UPDATE roles r
      SET organization_id = ro.organization_id
      FROM role_organizations ro
      WHERE r.id = ro.role_id
        AND r.organization_id IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rolesTable = await queryRunner.getTable('roles');
    const hasOrganizationId = rolesTable?.findColumnByName('organization_id');

    if (hasOrganizationId) {
      await queryRunner.dropColumn('roles', 'organization_id');
    }
  }
}
