import { DataSource } from 'typeorm';
import { Product, ProductKind } from './entities/product.entity';
import { Warehouse } from '../supply-chain/entities/warehouse.entity';
import { StockLedgerService } from './stock-ledger.service';
import { StockTransfersService } from './stock-transfers.service';
import { StockQueriesService } from './stock-queries.service';

/**
 * Identity rows are created by entity NAME: inventory does not import the organizations module.
 *
 * Stock by warehouse. `products.stock` was one number for the company, changed by editing the
 * product, and sales never wrote the stock ledger — so there was no answer to «how many are in
 * Santiago?» and the kardex could not explain the balance beside it.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('Stock by warehouse', () => {
  jest.setTimeout(60_000);
  let ds: DataSource;
  const ledger = new StockLedgerService();
  let transfers: StockTransfersService;
  let queries: StockQueriesService;
  let organizationId: string;
  let santiago: string;
  let capital: string;
  let productId: string;

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
    transfers = new StockTransfersService(ds, ledger);
    queries = new StockQueriesService(ds);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    organizationId = (await ds.getRepository('Organization').save({ legalName: `Almacenes ${stamp}` })).id;
    const warehouses = ds.getRepository(Warehouse);
    capital = (await warehouses.save({ organizationId, name: 'Capital', isActive: true, isDefault: true } as Warehouse)).id;
    santiago = (await warehouses.save({ organizationId, name: 'Santiago', isActive: true, isDefault: false } as Warehouse)).id;
    productId = (
      await ds.getRepository(Product).save({
        organizationId,
        name: `Cemento ${stamp}`,
        price: 500,
        cost: 300,
        stock: 0,
        kind: ProductKind.GOOD,
      } as unknown as Product)
    ).id;
  });

  afterEach(async () => {
    // Movements and levels go with the organization (cascade); warehouses are RESTRICTed by them,
    // so the ledger rows are cleared first.
    await ds.query(`DELETE FROM "stock_movements" WHERE "organization_id" = $1`, [organizationId]);
    await ds.query(`DELETE FROM "stock_levels" WHERE "organization_id" = $1`, [organizationId]);
    await ds.query(`DELETE FROM "stock_transfers" WHERE "organization_id" = $1`, [organizationId]);
    await ds.getRepository('Organization').delete({ id: organizationId });
  });

  const move = (warehouseId: string, quantity: number, type: 'PURCHASE_RECEIPT' | 'SALE_DISPATCH' = 'PURCHASE_RECEIPT') =>
    ds.transaction((manager) =>
      ledger.move(manager, organizationId, {
        productId,
        warehouseId,
        quantity,
        type,
        reference: 'prueba',
        sourceType: 'test',
        sourceId: null,
      }),
    );

  const product = () => ds.getRepository(Product).findOneByOrFail({ id: productId });

  it('keeps a balance per warehouse that adds up to the product total', async () => {
    await move(capital, 10);
    await move(santiago, 5);
    await move(capital, -3, 'SALE_DISPATCH');

    expect(await ledger.balance(ds.manager, productId, capital)).toBe(7);
    expect(await ledger.balance(ds.manager, productId, santiago)).toBe(5);
    expect(Number((await product()).stock)).toBe(12);
  });

  it('does not let one warehouse sell what another holds', async () => {
    await move(capital, 10);
    await expect(move(santiago, -1, 'SALE_DISPATCH')).rejects.toMatchObject({
      messageKey: 'inventory.not_enough_stock_in_warehouse',
    });
    expect(Number((await product()).stock)).toBe(10);
  });

  it('moves goods between warehouses without changing the company total', async () => {
    await move(capital, 10);
    const draft = await transfers.create(
      {
        date: new Date().toISOString().slice(0, 10),
        fromWarehouseId: capital,
        toWarehouseId: santiago,
        lines: [{ productId, quantity: 4 }],
      },
      organizationId,
      null,
    );
    expect(draft.number).toMatch(/^TR-\d{4}-\d{6}$/);
    expect(draft.lines[0].available).toBe(10);

    const posted = await transfers.post(draft.id, organizationId, null);
    expect(posted.status).toBe('POSTED');
    expect(await ledger.balance(ds.manager, productId, capital)).toBe(6);
    expect(await ledger.balance(ds.manager, productId, santiago)).toBe(4);
    expect(Number((await product()).stock)).toBe(10);

    // Posted once: a second post is refused rather than moving the goods again.
    await expect(transfers.post(draft.id, organizationId, null)).rejects.toMatchObject({
      messageKey: 'inventory.transfer_not_draft',
    });
  });

  it('refuses a transfer the origin cannot cover, and moves nothing', async () => {
    await move(capital, 2);
    const draft = await transfers.create(
      {
        date: new Date().toISOString().slice(0, 10),
        fromWarehouseId: capital,
        toWarehouseId: santiago,
        lines: [{ productId, quantity: 3 }],
      },
      organizationId,
      null,
    );
    await expect(transfers.post(draft.id, organizationId, null)).rejects.toMatchObject({
      messageKey: 'inventory.not_enough_stock_in_warehouse',
    });
    expect(await ledger.balance(ds.manager, productId, capital)).toBe(2);
    expect(await ledger.balance(ds.manager, productId, santiago)).toBe(0);
  });

  it('reads a kardex with a running balance, per warehouse or for the company', async () => {
    await move(capital, 10);
    await move(santiago, 5);
    await move(capital, -4, 'SALE_DISPATCH');

    const company = await queries.movements(organizationId, { productId });
    expect(company.items.map((row) => row.balance)).toEqual([10, 15, 11]);

    const atCapital = await queries.movements(organizationId, { productId, warehouseId: capital });
    expect(atCapital.items.map((row) => [row.quantity, row.balance])).toEqual([
      [10, 10],
      [-4, 6],
    ]);

    const register = await queries.onHand(organizationId, { productId });
    expect(register.items.map((row) => [row.warehouseName, row.quantityOnHand])).toEqual([
      ['Capital', 6],
      ['Santiago', 5],
    ]);
    expect(register.totalValue).toBe(3_300);
  });

  it('places stock in the default warehouse when a document names none, creating one if needed', async () => {
    expect(await ds.transaction((manager) => ledger.resolveWarehouse(manager, organizationId))).toBe(capital);

    const bare = (await ds.getRepository('Organization').save({ legalName: `Sin almacenes ${Date.now()}` })).id;
    try {
      const created = await ds.transaction((manager) => ledger.defaultWarehouse(manager, bare));
      expect(created).toMatchObject({ name: 'Almacén principal', isDefault: true, isActive: true });
      const again = await ds.transaction((manager) => ledger.defaultWarehouse(manager, bare));
      expect(again.id).toBe(created.id);
    } finally {
      await ds.getRepository(Warehouse).delete({ organizationId: bare });
      await ds.getRepository('Organization').delete({ id: bare });
    }
  });
});
