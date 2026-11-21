import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchContext, SearchSource, SearchSourceRegistry } from '../contracts/search/search-source.contract';

/**
 * BUS-01/02/03 (audit 2026-10-31): the global search answered every group to every authenticated
 * user, loaded the whole catalogue and customer book on every keystroke, and threw a 500 without `q`.
 *
 * The service no longer knows the three modules it used to call — each domain registers what it
 * offers (`contracts/search`), which is what removed two module cycles from platform. The guarantee
 * that mattered is unchanged and still asserted here: a group is searched only for a principal
 * holding the permission that group's own module requires.
 */
describe('SearchService', () => {
  /** A source as a module registers one: its own type, its own permission, its own query. */
  const source = (type: string, viewPermission: string, sortOrder: number, found: object[]): SearchSource & { find: jest.Mock } => ({
    type,
    viewPermission,
    sortOrder,
    find: jest.fn(async (_query: string, _context: SearchContext) => found as never),
  });

  function service() {
    const invoices = source('Invoices', 'invoices:view', 10, [{ id: 'i1', link: '/invoices/i1' }]);
    const products = source('Products', 'products:view', 20, [{ id: 'p1', link: '/inventory/products/p1/edit' }]);
    const customers = source('Customers', 'customers:view', 30, [{ id: 'c1', link: '/contacts/customers/c1/edit' }]);
    const registry = new SearchSourceRegistry();
    // Registered out of order on purpose: the screen's order is the declared one, not this one.
    for (const each of [customers, invoices, products]) registry.register(each);
    return { svc: new SearchService(registry), registry, invoices, products, customers };
  }
  const user = (permissions: string[]) => ({ id: 'u1', organizationId: 'org-1', permissions });

  it('offers only the groups the caller may read', async () => {
    const { svc, invoices, customers } = service();
    const groups = await svc.search('qa', user(['products:view']));
    expect(groups.map((g) => g.type)).toEqual(['Products']);
    // The other modules are not even asked.
    expect(invoices.find).not.toHaveBeenCalled();
    expect(customers.find).not.toHaveBeenCalled();
  });

  it('answers nothing to a principal with no view permission at all', async () => {
    const { svc } = service();
    await expect(svc.search('qa', user(['hr:view']))).resolves.toEqual([]);
  });

  it('hands every source the caller, the company and the limit, so each filters in the database', async () => {
    const { svc, invoices, products, customers } = service();
    await svc.search('qa', user(['*']), 5);
    const context = { organizationId: 'org-1', actorUserId: 'u1', limit: 5 };
    expect(invoices.find).toHaveBeenCalledWith('qa', context);
    expect(products.find).toHaveBeenCalledWith('qa', context);
    expect(customers.find).toHaveBeenCalledWith('qa', context);
  });

  it('returns the groups in their declared order, whatever order they registered in', async () => {
    const { svc } = service();
    const groups = await svc.search('qa', user(['*']));
    expect(groups.map((g) => g.type)).toEqual(['Invoices', 'Products', 'Customers']);
  });

  it('leaves out a group that found nothing, and a module that registered nothing', async () => {
    const registry = new SearchSourceRegistry();
    registry.register(source('Invoices', 'invoices:view', 10, []));
    const groups = await new SearchService(registry).search('qa', user(['*']));
    expect(groups).toEqual([]);
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
