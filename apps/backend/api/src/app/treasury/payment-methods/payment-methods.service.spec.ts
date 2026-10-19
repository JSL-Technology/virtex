import { ConflictError, ForbiddenError } from '../../i18n/localized.exception';
import { PaymentMethod } from '../entities/payment-method.entity';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Payment methods are editable per market (QA C-06).
 *
 * A US company could not add ACH or Zelle because the screen showed the DGII's fixed catalogue to
 * everyone. The catalogue is the authority's only where the country pack says so (the Dominican
 * Republic); everywhere else the company shapes its own.
 */
describe('PaymentMethodsService', () => {
  const ORG = 'org-1';
  let rows: PaymentMethod[];

  const method = (overrides: Partial<PaymentMethod>): PaymentMethod =>
    Object.assign(new PaymentMethod(), {
      id: 'pm-1',
      organizationId: ORG,
      code: 'ACH',
      name: 'ACH transfer',
      kind: 'BANK_TRANSFER',
      fiscalCode: null,
      isSystem: false,
      isActive: true,
      sortOrder: 10,
      ...overrides,
    });

  function serviceIn(country: string | null) {
    const repository = {
      find: jest.fn(async () => rows),
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null),
      exists: jest.fn(async ({ where }: { where: { code: string } }) => rows.some((row) => row.code === where.code)),
      create: jest.fn((input: Partial<PaymentMethod>) => method(input)),
      save: jest.fn(async (row: PaymentMethod) => row),
      query: jest.fn(async () => [{ next: 80 }]),
    };
    const tenantCountry = { resolveOrNull: jest.fn(async () => country) };
    return {
      service: new PaymentMethodsService(repository as never, tenantCountry as never),
      repository,
    };
  }

  beforeEach(() => {
    rows = [method({})];
  });

  it('lets a US company add a method, normalising its code', async () => {
    const { service, repository } = serviceIn('US');
    const created = await service.create({ code: ' paypal ', name: 'PayPal', kind: 'BANK_TRANSFER' }, ORG);
    expect(created).toMatchObject({ code: 'PAYPAL', name: 'PayPal', isSystem: false, isActive: true, sortOrder: 80 });
    expect(repository.save).toHaveBeenCalled();
  });

  it('refuses a second method with the same code', async () => {
    const { service } = serviceIn('US');
    await expect(service.create({ code: 'ach', name: 'ACH again', kind: 'BANK_TRANSFER' }, ORG)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('renames, re-maps and retires a company method', async () => {
    const { service } = serviceIn('US');
    const updated = await service.update('pm-1', { name: 'ACH (same day)', fiscalCode: ' 03 ', isActive: false }, ORG);
    expect(updated).toMatchObject({ name: 'ACH (same day)', fiscalCode: '03', isActive: false });
  });

  it('never changes a code documents already recorded', async () => {
    const { service } = serviceIn('US');
    await expect(service.update('pm-1', { code: 'ACH2' }, ORG)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.update('pm-1', { code: 'ach' }, ORG)).resolves.toMatchObject({ code: 'ACH' });
  });

  it('keeps the DGII catalogue fixed for a Dominican company: nothing is added or changed', async () => {
    rows = [method({ id: 'pm-dgii', code: '01', isSystem: true, fiscalCode: '01' })];
    const { service } = serviceIn('DO');
    await expect(service.create({ code: 'ZELLE', name: 'Zelle', kind: 'BANK_TRANSFER' }, ORG)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.update('pm-dgii', { name: 'Cash' }, ORG)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses to edit an authority row wherever it is', async () => {
    rows = [method({ id: 'pm-sys', isSystem: true })];
    const { service } = serviceIn('MX');
    await expect(service.update('pm-sys', { name: 'x' }, ORG)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
