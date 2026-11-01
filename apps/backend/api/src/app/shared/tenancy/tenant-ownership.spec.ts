import { assertTenantMember, assertTenantOwns } from './tenant-ownership';

class Thing {}

function managerCounting(found: number) {
  const count = jest.fn().mockResolvedValue(found);
  return { manager: { getRepository: jest.fn().mockReturnValue({ count }) } as never, count };
}

describe('assertTenantOwns', () => {
  it('passes when every referenced id belongs to the tenant', async () => {
    const { manager, count } = managerCounting(2);
    await expect(assertTenantOwns(manager, Thing, ['a', 'b', 'a'], 'org-1')).resolves.toBeUndefined();
    // Duplicates are collapsed before counting, or two lines naming the same product would fail.
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ organizationId: 'org-1' }) });
  });

  it('answers "not found" when any id is foreign or missing', async () => {
    const { manager } = managerCounting(1);
    await expect(assertTenantOwns(manager, Thing, ['mine', 'theirs'], 'org-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('ignores absent references and refuses to check against no tenant', async () => {
    const { manager, count } = managerCounting(0);
    await expect(assertTenantOwns(manager, Thing, [null, undefined], 'org-1')).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
    await expect(assertTenantOwns(manager, Thing, 'x', '')).rejects.toMatchObject({ status: 404 });
  });

  it('honours a differently named tenant column', async () => {
    const { manager, count } = managerCounting(1);
    await assertTenantOwns(manager, Thing, 'x', 'org-1', { tenantColumn: 'tenantId' });
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ tenantId: 'org-1' }) });
  });
});

describe('assertTenantMember', () => {
  it('accepts a member and refuses anyone else', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ member: true }]).mockResolvedValueOnce([{ member: false }]);
    const manager = { query } as never;
    await expect(assertTenantMember(manager, 'u-1', 'org-1')).resolves.toBeUndefined();
    await expect(assertTenantMember(manager, 'u-2', 'org-1')).rejects.toMatchObject({ status: 404 });
    await expect(assertTenantMember(manager, null, 'org-1')).resolves.toBeUndefined();
  });
});

describe('assertTenantOwns by table name (another module)', () => {
  it('counts through SQL with the ids bound as parameters', async () => {
    const query = jest.fn().mockResolvedValue([{ n: 2 }]);
    await assertTenantOwns({ query } as never, 'products', ['a', 'b'], 'org-1');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM "products"'), [['a', 'b'], 'org-1']);
  });

  it('refuses anything that is not a plain identifier', async () => {
    const query = jest.fn();
    await expect(assertTenantOwns({ query, getRepository: () => { throw new Error('not an entity'); } } as never, 'products; drop table x', ['a'], 'org-1')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
