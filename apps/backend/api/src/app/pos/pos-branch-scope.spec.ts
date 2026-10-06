import { DataSource } from 'typeorm';
import { Reflector } from '@nestjs/core';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { PosShift, PosShiftStatus } from './entities/pos-shift.entity';
import { PosController } from './pos.controller';
import { BranchScopeInterceptor } from '../organizations/contracts/branch-scope.interceptor';

/**
 * Lists hid other branches' documents and opening one by id was refused, but every other action
 * on one document — issue, void, pay, close — went to the service by id. A cashier limited to one
 * store could close another store's till by pasting its id. `@BranchScoped` closes that on the
 * route; closing a shift is the case exercised here, through the real controller's metadata.
 *
 * Identity rows are created through the data source by entity NAME: this module may not import
 * the organizations module's entities, and the test should not either.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('Branch scope on actions over one document', () => {
  jest.setTimeout(60_000);
  let ds: DataSource;
  let interceptor: BranchScopeInterceptor;
  let organizationId: string;
  let userId: string;
  let store: string;
  let other: string;

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
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await ds.initialize();
    interceptor = new BranchScopeInterceptor(new Reflector(), ds);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    organizationId = (await ds.getRepository('Organization').save({ legalName: `Alcance ${stamp}` })).id;
    userId = (
      await ds.getRepository('User').save({
        firstName: 'Caja',
        lastName: 'Uno',
        email: `scope-${stamp}@example.test`,
        organizationId,
        status: 'ACTIVE',
      })
    ).id;
    await ds.getRepository('UserOrganization').insert({ userId, organizationId });
    const branches = ds.getRepository('Branch');
    store = (await branches.save({ organizationId, code: 'S1', name: 'Tienda', isHeadquarters: true, isActive: true })).id;
    other = (await branches.save({ organizationId, code: 'S2', name: 'Otra', isHeadquarters: false, isActive: true })).id;
  });

  afterEach(async () => {
    await ds.getRepository('Organization').delete({ id: organizationId });
    await ds.getRepository('User').delete({ id: userId });
  });

  const shiftAt = async (branchId: string | null, terminalId: string): Promise<string> =>
    (
      await ds.getRepository(PosShift).save({
        organizationId,
        branchId,
        userId,
        terminalId,
        openingBalance: 0,
        status: PosShiftStatus.OPEN,
      })
    ).id;

  const restrictTo = (branchId: string) =>
    ds.getRepository('UserBranchAccess').insert({ organizationId, userId, branchId });

  const closeShift = (id: string) => {
    const context = {
      getHandler: () => PosController.prototype.closeShift,
      getClass: () => PosController,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: userId, organizationId }, params: { id } }) }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('closed') };
    return firstValueFrom(interceptor.intercept(context, next));
  };

  it('lets a person with every branch act on any branch\'s document', async () => {
    await expect(closeShift(await shiftAt(other, 'T-2'))).resolves.toBe('closed');
  });

  it('keeps a restricted person to their own branch\'s documents', async () => {
    const mine = await shiftAt(store, 'T-1');
    const theirs = await shiftAt(other, 'T-2');
    const legacy = await shiftAt(null, 'T-3');
    await restrictTo(store);

    await expect(closeShift(mine)).resolves.toBe('closed');
    await expect(closeShift(theirs)).rejects.toMatchObject({ messageKey: 'organizations.branches.outside_your_scope' });
    // A document from before branches existed is visible only to people with every branch.
    await expect(closeShift(legacy)).rejects.toMatchObject({ messageKey: 'organizations.branches.outside_your_scope' });
  });

  it('lets a document that does not exist through, so the handler answers 404', async () => {
    await restrictTo(store);
    await expect(closeShift('00000000-0000-4000-8000-000000000000')).resolves.toBe('closed');
  });
});
