import { DataSource } from 'typeorm';
import { PayrollConceptService } from './services/payroll-concept.service';
import { PayrollConcept } from './entities/payroll-concept.entity';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../common/database/testing/integration-db';

/**
 * A payroll concept that has been used stays, deactivated.
 *
 * Part of the record-lifecycle audit (docs/CICLO_DE_VIDA_DE_REGISTROS.md): a record nothing
 * depends on can be deleted; a used one is deactivated, closed, cancelled or retired; a posted one
 * is reversed. This `remove()` used to be a bare `repository.delete()`.
 */
describeWithDb('payroll concept lifecycle', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'payroll concept lifecycle');
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('a payroll concept that has been used stays, deactivated', async () => {
    const concepts = new PayrollConceptService(dataSource.getRepository(PayrollConcept));
    const [concept, run, employee] = [await newId(dataSource), await newId(dataSource), await newId(dataSource)];
    await dataSource.query(
      `INSERT INTO payroll_concepts (id, organization_id, code, name, type) VALUES ($1, $2, 'BONO', 'Bono', 'EARNING')`,
      [concept, organizationId],
    );
    await dataSource.query(
      `INSERT INTO employees (id, organization_id, first_name, last_name, email) VALUES ($1, $2, 'Ana', 'Pérez', $3)`,
      [employee, organizationId, `ana-${employee}@ejemplo.test`],
    );
    await dataSource.query(
      `INSERT INTO payroll_runs (id, organization_id, name, country_code, period_year, period_month, period_start, period_end, pay_date)
       VALUES ($1, $2, 'Septiembre', 'DO', 2026, 9, '2026-09-01', '2026-09-30', '2026-09-30')`,
      [run, organizationId],
    );
    await dataSource.query(
      `INSERT INTO payroll_inputs (organization_id, run_id, employee_id, concept_code) VALUES ($1, $2, $3, 'BONO')`,
      [organizationId, run, employee],
    );
    await expect(concepts.remove(concept, organizationId)).rejects.toMatchObject({
      messageKey: 'payroll.concept_in_use_deactivate_instead',
    });
  });
});
