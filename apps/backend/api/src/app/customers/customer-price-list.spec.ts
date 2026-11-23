import { CustomersService } from './customers.service';

/**
 * FAC-PL-01: a price list is a discount policy. Assigning one to a customer needs
 * `price_lists:edit`; `customers:edit` alone would let any seller move an account onto the
 * wholesale prices.
 */
describe('CustomersService: who may assign a price list', () => {
  const build = (current: string | null) => {
    const customer = { id: 'c-1', organizationId: 'org-1', priceListId: current, taxId: null };
    const repository = {
      findOne: jest.fn(async () => ({ ...customer })),
      merge: jest.fn((target: object, patch: object) => Object.assign(target, patch)),
      save: jest.fn(async (value: object) => value),
    };
    // The list is the tenant's: the ownership check counts one row.
    const dataSource = { manager: { query: jest.fn(async () => [{ n: 1 }]) } };
    const service = new CustomersService(repository as never, dataSource as never, {} as never, {} as never, {} as never);
    return { service, repository };
  };

  it('refuses a seller who changes the list', async () => {
    const { service, repository } = build(null);
    await expect(
      service.update('c-1', { priceListId: 'pl-wholesale' }, 'org-1', { mayAssignPriceList: false }),
    ).rejects.toMatchObject({ messageKey: 'customers.price_list_assignment_forbidden' });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('lets the same seller save a form that echoes the current list back', async () => {
    const { service, repository } = build('pl-wholesale');
    await service.update('c-1', { priceListId: 'pl-wholesale', phone: '809-555-0101' }, 'org-1', { mayAssignPriceList: false });
    expect(repository.save).toHaveBeenCalled();
  });

  it('lets whoever may edit price lists assign one', async () => {
    const { service, repository } = build(null);
    await service.update('c-1', { priceListId: 'pl-wholesale' }, 'org-1', { mayAssignPriceList: true });
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ priceListId: 'pl-wholesale' }));
  });
});
