import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class RolesLegacyOrganizationBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RolesLegacyOrganizationBackfillService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.dataSource.options.type !== 'postgres') {
      return;
    }

    await this.backfillLegacyRoleOrganizations();
  }

  private async backfillLegacyRoleOrganizations(): Promise<void> {
    try {
      const result: Array<{ updated_count: string }> = await this.dataSource.query(`
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
        ), updated_roles AS (
          UPDATE roles r
          SET organization_id = ro.organization_id
          FROM role_organizations ro
          WHERE r.id = ro.role_id
            AND r.organization_id IS NULL
          RETURNING r.id
        )
        SELECT COUNT(*)::text AS updated_count FROM updated_roles;
      `);

      const updatedCount = Number(result[0]?.updated_count ?? 0);
      if (updatedCount > 0) {
        this.logger.log(`Se asignó organization_id a ${updatedCount} roles heredados.`);
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo completar el backfill de organization_id para roles heredados: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
