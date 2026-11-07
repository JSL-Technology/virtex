import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

/**
 * BUS-01/02/03 (audit 2026-10-31): the global search answered every group to every authenticated
 * user, loaded the whole catalogue and customer book on every keystroke, and threw a 500 without `q`.
 */
describe('SearchService', () => {
  function service() {
    const invoices = {
      findAll: jest.fn().mockResolvedValue({
        items: [{ id: 'i1', invoiceNumber: 'F-1', customerName: 'Cliente QA', total: 10, currencyCode: 'DOP', status: 'ISSUED' }],
      }),
    };
    const inventory = { findAll: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Producto QA', sku: 'QA-1' }]) };
    const customers = { findAll: jest.fn().mockResolvedValue([{ id: 'c1', companyName: 'Cliente QA', taxId: '101' }]) };
    return {
      svc: new SearchService(invoices as never, inventory as never, customers as never),
      invoices,
      inventory,
      customers,
    };
  }
  const user = (permissions: string[]) => ({ id: 'u1', organizationId: 'org-1', permissions });

  it('offers only the groups the caller may read', async () => {
    const { svc, invoices, customers } = service();
    const groups = await svc.search('qa', user(['products:view']));
    expect(groups.map((g) => g.type)).toEqual(['Products']);
    // The other modules are not even asked.
    expect(invoices.findAll).not.toHaveBeenCalled();
    expect(customers.findAll).not.toHaveBeenCalled();
  });

  it('answers nothing to a principal with no view permission at all', async () => {
    const { svc } = service();
    await expect(svc.search('qa', user(['hr:view']))).resolves.toEqual([]);
  });

  it('narrows invoices to the caller and filters every group in the database', async () => {
    const { svc, invoices, inventory, customers } = service();
    await svc.search('qa', user(['*']), 5);
    expect(invoices.findAll).toHaveBeenCalledWith('org-1', { search: 'qa', limit: 5, actorUserId: 'u1' });
    expect(inventory.findAll).toHaveBeenCalledWith('org-1', { search: 'qa', limit: 5 });
    expect(customers.findAll).toHaveBeenCalledWith('org-1', { search: 'qa', limit: 5 });
  });

  it.each([
    [{}, 'q missing'],
    [{ q: '' }, 'q empty'],
    [{ q: '  a ' }, 'q one character once trimmed'],
    [{ q: 'qa', limit: '500' }, 'limit too large'],
  ] as Array<[object, string]>)('refuses %j (%s) instead of failing or answering everything', async (query) => {
    const errors = await validate(plainToInstance(SearchQueryDto, query));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a real query', async () => {
    const dto = plainToInstance(SearchQueryDto, { q: '  Cliente ', limit: '5' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.q).toBe('Cliente');
    expect(dto.limit).toBe(5);
  });
});
