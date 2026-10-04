import { HcmService } from './hcm.service';
import { HcmController } from './hcm.controller';
import { EmployeeCompensation } from './entities/employee-compensation.entity';
import { PERMISSIONS } from '../shared/permissions';

/**
 * QA M-15: a hire had no salary; it was added afterwards through a second form and a second
 * re-authentication. The hire now carries it, in the same transaction.
 */
describe('hiring with a starting salary', () => {
  const saved: unknown[] = [];
  const manager = {
    save: jest.fn(async (row: Record<string, unknown>) => {
      saved.push(row);
      return { id: 'emp-1', ...row };
    }),
    create: jest.fn((entity: unknown, row: Record<string, unknown>) => ({ __entity: entity, ...row })),
  };
  const employeeRepository = {
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn(async (row: Record<string, unknown>) => ({ id: 'emp-0', ...row })),
    manager: { transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)) },
  };
  const service = new HcmService(employeeRepository as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  // Identity and statutory checks have their own suites; here they pass.
  Object.assign(service as unknown as Record<string, unknown>, {
    resolveIdentityDocument: jest.fn(async () => ({ identityDocument: null })),
    assertStatutoryIdentifiers: jest.fn(async () => undefined),
  });

  const hire = { firstName: 'Ana', lastName: 'Pérez', email: 'ana@x.test', hireDate: '2026-10-01' };

  beforeEach(() => {
    saved.length = 0;
    jest.clearAllMocks();
  });

  it('saves the person and the salary together, dated the hire day', async () => {
    await service.createEmployee({ ...hire, initialCompensation: { baseSalary: 45_000 } }, 'org-1');

    expect(employeeRepository.manager.transaction).toHaveBeenCalled();
    const compensation = saved.find((row) => (row as { __entity?: unknown }).__entity === EmployeeCompensation);
    expect(compensation).toMatchObject({ baseSalary: 45_000, effectiveFrom: '2026-10-01', employeeId: 'emp-1', organizationId: 'org-1' });
    expect(saved[0]).not.toHaveProperty('initialCompensation');
  });

  it('keeps the ordinary path when no salary is given', async () => {
    await service.createEmployee(hire, 'org-1');
    expect(employeeRepository.manager.transaction).not.toHaveBeenCalled();
    expect(employeeRepository.save).toHaveBeenCalled();
  });

  it('needs a date for the salary when there is no hire date', async () => {
    const { hireDate: _omit, ...undated } = hire;
    await expect(service.createEmployee({ ...undated, initialCompensation: { baseSalary: 1 } }, 'org-1')).rejects.toMatchObject({
      messageKey: 'hcm.initial_compensation_needs_date',
    });
  });

  it('refuses a salary from someone without the compensation right', async () => {
    const controller = new HcmController(service);
    await expect(
      controller.createEmployee(
        { ...hire, initialCompensation: { baseSalary: 1 } },
        { id: 'u', organizationId: 'org-1', permissions: [PERMISSIONS.HCM_MANAGE] } as never,
      ),
    ).rejects.toMatchObject({ messageKey: 'auth.you_do_not_have_permission_perform' });
  });
});
