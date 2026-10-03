import { DataSource } from 'typeorm';
import { ProjectsService } from './projects.service';
import { Project } from './entities/project.entity';
import { ProjectTask } from './entities/project-task.entity';
import { Timesheet } from './entities/timesheet.entity';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../common/database/testing/integration-db';

/**
 * A project with booked hours is closed, not deleted.
 *
 * Part of the record-lifecycle audit (docs/CICLO_DE_VIDA_DE_REGISTROS.md): a record nothing
 * depends on can be deleted; a used one is deactivated, closed, cancelled or retired; a posted one
 * is reversed. This `remove()` used to be a bare `repository.delete()`.
 */
describeWithDb('project lifecycle', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'project lifecycle');
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('a project with booked hours is closed, not deleted', async () => {
    const projects = new ProjectsService(
      dataSource.getRepository(Project),
      dataSource.getRepository(ProjectTask),
      dataSource.getRepository(Timesheet),
    );
    const [used, unused] = [await newId(dataSource), await newId(dataSource)];
    for (const id of [used, unused]) {
      await dataSource.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'Implantación')`, [
        id,
        organizationId,
      ]);
    }
    await dataSource.query(
      `INSERT INTO timesheets (organization_id, project_id, user_id, date, hours) VALUES ($1, $2, $3, '2026-09-01', 6)`,
      [organizationId, used, await newId(dataSource)],
    );

    await expect(projects.removeProject(used, organizationId)).rejects.toMatchObject({
      code: 'DELETE_BLOCKED',
      messageKey: 'projects.project_in_use_close_instead',
      params: { dependents: [{ label: 'common.dependents.timesheets', count: 1 }] },
    });
    await expect(projects.removeProject(unused, organizationId)).resolves.toBeUndefined();
  });
});
