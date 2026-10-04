import { DataSource } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { UserOrganization } from '../entities/user-organization.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { BranchesService } from './branches.service';
import { applyBranchScope, loadBranchScope, resolveDocumentBranch } from '../contracts/branch.contract';
import { UserBranchAccess } from '../entities/user-branch-access.entity';

/**
 * Branches: the places one legal entity operates from. A company with one tax id and three stores
 * could not say where a document was issued, and «Sucursales» was a read-only copy of the
 * subsidiaries — other legal entities — under the wrong name.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('BranchesService', () => {
  jest.setTimeout(60_000);
  let ds: DataSource;
  let service: BranchesService;
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../../**/*.entity.{js,ts}`],
    });
    await ds.initialize();
    service = new BranchesService(ds.getRepository('Branch'), ds);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const org = await ds.getRepository(Organization).save({ legalName: `Sucursales ${stamp}` } as Organization);
    organizationId = org.id;
    const user = await ds.getRepository(User).save({
      firstName: 'Ana',
      lastName: 'Pérez',
      email: `br-${stamp}@example.test`,
      organizationId,
      status: UserStatus.ACTIVE,
    } as unknown as User);
    userId = user.id;
    await ds.getRepository(UserOrganization).insert({ userId, organizationId });
  });

  afterEach(async () => {
    await ds.getRepository(Organization).delete({ id: organizationId });
    await ds.getRepository(User).delete({ id: userId });
  });

  const branch = (code: string, over: Record<string, unknown> = {}) =>
    service.create({ code, name: `Sucursal ${code}`, ...over } as never, organizationId);

  it('makes the first branch the headquarters, and keeps a single one', async () => {
    const first = await branch('matriz');
    expect(first.code).toBe('MATRIZ');
    expect(first.isHeadquarters).toBe(true);

    const second = await branch('STI-01', { isHeadquarters: true });
    const list = await service.findAll(organizationId);
    expect(list.filter((b) => b.isHeadquarters).map((b) => b.id)).toEqual([second.id]);
  });

  it('refuses a repeated code and deactivating the headquarters', async () => {
    const hq = await branch('MATRIZ');
    await expect(branch('matriz')).rejects.toMatchObject({ messageKey: 'organizations.branches.code_taken' });
    await expect(service.update(hq.id, { isActive: false }, organizationId)).rejects.toMatchObject({
      messageKey: 'organizations.branches.headquarters_cannot_deactivate',
    });
  });

  it('issues a document from the default branch, then the headquarters, and nowhere when there are none', async () => {
    await expect(resolveDocumentBranch(ds.manager, organizationId, userId)).resolves.toBeNull();

    const hq = await branch('MATRIZ');
    const store = await branch('STI-01');
    await expect(resolveDocumentBranch(ds.manager, organizationId, userId)).resolves.toBe(hq.id);

    await service.setUserAccess(organizationId, userId, { branchIds: [], defaultBranchId: store.id });
    await expect(resolveDocumentBranch(ds.manager, organizationId, userId)).resolves.toBe(store.id);
  });

  it('keeps a restricted person inside their branches', async () => {
    const hq = await branch('MATRIZ');
    const store = await branch('STI-01');
    await service.setUserAccess(organizationId, userId, { branchIds: [store.id], defaultBranchId: null });

    // Their only branch is used when they name none, and the headquarters is refused when they do.
    await expect(resolveDocumentBranch(ds.manager, organizationId, userId)).resolves.toBe(store.id);
    await expect(resolveDocumentBranch(ds.manager, organizationId, userId, hq.id)).rejects.toMatchObject({
      messageKey: 'organizations.branches.outside_your_scope',
    });

    const mine = await service.mine(organizationId, userId);
    expect(mine.branches.map((b) => b.id)).toEqual([store.id]);
    expect(mine.restricted).toBe(true);
  });

  it('requires a choice when a person works at several branches with no default', async () => {
    const a = await branch('A');
    const b = await branch('B');
    await service.setUserAccess(organizationId, userId, { branchIds: [a.id, b.id], defaultBranchId: null });
    // The headquarters is A, which they may use — so it is still a sensible default.
    await expect(resolveDocumentBranch(ds.manager, organizationId, userId)).resolves.toBe(a.id);

    const c = await branch('C', { isHeadquarters: true });
    expect(c.isHeadquarters).toBe(true);
    await expect(resolveDocumentBranch(ds.manager, organizationId, userId)).rejects.toMatchObject({
      messageKey: 'organizations.branches.branch_required',
    });
  });

  it('refuses a default branch outside the person\'s branches', async () => {
    const a = await branch('A');
    const b = await branch('B');
    await expect(
      service.setUserAccess(organizationId, userId, { branchIds: [a.id], defaultBranchId: b.id }),
    ).rejects.toMatchObject({ messageKey: 'organizations.branches.default_outside_access' });
  });

  it('narrows a document list to the person\'s branches', async () => {
    const hq = await branch('MATRIZ');
    const store = await branch('STI-01');
    await service.setUserAccess(organizationId, userId, { branchIds: [store.id], defaultBranchId: null });
    const scope = await loadBranchScope(ds.manager, organizationId, userId);

    const query = applyBranchScope(ds.getRepository(UserBranchAccess).createQueryBuilder('row'), 'row', scope);
    expect(query.getParameters()).toMatchObject({ scopeAllowedBranches: [store.id] });
    expect(() =>
      applyBranchScope(ds.getRepository(UserBranchAccess).createQueryBuilder('row'), 'row', scope, hq.id),
    ).toThrow();
  });

  it('deletes an unused branch but not the headquarters', async () => {
    const hq = await branch('MATRIZ');
    const unused = await branch('TEMP');
    await service.remove(unused.id, organizationId);
    await expect(service.findOne(unused.id, organizationId)).rejects.toBeDefined();
    await expect(service.remove(hq.id, organizationId)).rejects.toMatchObject({
      messageKey: 'organizations.branches.headquarters_cannot_delete',
    });
  });

  it('refuses to delete a branch something was issued from, and offers deactivation instead', async () => {
    await branch('MATRIZ');
    const store = await branch('STI-01');
    await ds.query(
      `INSERT INTO "warehouses" ("name", "organization_id", "branch_id") VALUES ($1, $2, $3)`,
      ['Almacén Santiago', organizationId, store.id],
    );

    await expect(service.remove(store.id, organizationId)).rejects.toMatchObject({
      messageKey: 'organizations.branches.in_use',
    });
    const deactivated = await service.update(store.id, { isActive: false }, organizationId);
    expect(deactivated.isActive).toBe(false);
  });
});
