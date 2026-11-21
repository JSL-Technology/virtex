import { DataSource } from 'typeorm';
import { PriceResolver, pickBreak } from './price-resolver.service';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * FAC-PL-01 (audit 2026-11-07): price lists were created and never read. A tenant that set up a
 * «Mayorista» list kept billing at the catalogue price on every invoice, quote and till sale.
 */
describe('pickBreak', () => {
  const breaks = [
    { minQuantity: 1, price: 100 },
    { minQuantity: 12, price: 90 },
    { minQuantity: 100, price: 80 },
  ];

  it('takes the largest minimum the quantity reaches', () => {
    expect(pickBreak(breaks, 1)?.price).toBe(100);
    expect(pickBreak(breaks, 11.99)?.price).toBe(100);
    expect(pickBreak(breaks, 12)?.price).toBe(90);
    expect(pickBreak(breaks, 500)?.price).toBe(80);
  });

  it('says nothing below the smallest minimum, so the catalogue applies', () => {
    expect(pickBreak([{ minQuantity: 12, price: 90 }], 3)).toBeNull();
    expect(pickBreak(undefined, 3)).toBeNull();
  });
});

describeWithDb('PriceResolver, against PostgreSQL', () => {
  let ds: DataSource;
  let organizationId: string;
  let resolver: PriceResolver;
  let wholesaleCustomer: string;
  let retailCustomer: string;
  let product: string;
  let unlisted: string;
  let wholesaleList: string;

  const list = async (name: string, currency: string, opts: { isDefault?: boolean; status?: string; from?: string; to?: string } = {}) => {
    const [{ id }] = await ds.query(
      `INSERT INTO price_lists (name, currency, "validFrom", "validTo", status, organization_id, is_default)
       VALUES ($1, $2, $3, $4, $5::price_lists_status_enum, $6, $7) RETURNING id`,
      [name, currency, opts.from ?? '2026-01-01', opts.to ?? '2026-12-31', opts.status ?? 'Active', organizationId, opts.isDefault ?? false],
    );
    return id as string;
  };
  const item = (priceListId: string, productId: string, price: number, minQuantity = 1) =>
    ds.query(`INSERT INTO price_list_items (price_list_id, product_id, price, min_quantity) VALUES ($1, $2, $3, $4)`, [priceListId, productId, price, minQuantity]);

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'price-lists');
    resolver = new PriceResolver(ds);
    await ds.query(`INSERT INTO organization_settings (organization_id, base_currency) VALUES ($1, 'DOP')`, [organizationId]);
    [{ id: product }] = await ds.query(`INSERT INTO products (name, price, organization_id) VALUES ('QA Café', 120, $1) RETURNING id`, [organizationId]);
    [{ id: unlisted }] = await ds.query(`INSERT INTO products (name, price, organization_id) VALUES ('QA Azúcar', 50, $1) RETURNING id`, [organizationId]);

    wholesaleList = await list('QA Mayorista', 'DOP');
    await item(wholesaleList, product, 100);
    await item(wholesaleList, product, 90, 12);
    const defaultList = await list('QA General', 'DOP', { isDefault: true });
    await item(defaultList, product, 115);
    const usdList = await list('QA Exportación', 'USD');
    await item(usdList, product, 2);
    const expired = await list('QA Vieja', 'DOP', { from: '2025-01-01', to: '2025-12-31' });
    await item(expired, product, 1);

    [{ id: wholesaleCustomer }] = await ds.query(
      `INSERT INTO customers ("companyName", organization_id, price_list_id) VALUES ('QA Colmado', $1, $2) RETURNING id`,
      [organizationId, wholesaleList],
    );
    [{ id: retailCustomer }] = await ds.query(`INSERT INTO customers ("companyName", organization_id) VALUES ('QA Cliente', $1) RETURNING id`, [organizationId]);
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM customers WHERE organization_id = $1`, [organizationId]);
    await ds.query(`DELETE FROM price_lists WHERE organization_id = $1`, [organizationId]);
    await dropTestOrganization(ds, organizationId);
  });

  const ctx = (customerId: string | null, currencyCode = 'DOP', date = '2026-11-08') => ({ customerId, currencyCode, date });

  it("the customer's list, with its quantity breaks", async () => {
    const [one, dozen] = await resolver.resolve(organizationId, ctx(wholesaleCustomer), [
      { productId: product, quantity: 1 },
      { productId: product, quantity: 24 },
    ]);
    expect(one).toMatchObject({ unitPrice: 100, priceListId: wholesaleList, priceListName: 'QA Mayorista' });
    expect(dozen).toMatchObject({ unitPrice: 90, minQuantity: 12 });
  });

  it('a customer without a list gets the default list for the currency', async () => {
    const [line] = await resolver.resolve(organizationId, ctx(retailCustomer), [{ productId: product, quantity: 1 }]);
    expect(line).toMatchObject({ unitPrice: 115, priceListName: 'QA General' });
  });

  it("a document in another currency does not take the customer's peso list, nor convert it", async () => {
    const [line] = await resolver.resolve(organizationId, ctx(wholesaleCustomer, 'USD'), [{ productId: product, quantity: 1 }]);
    // No USD default and the USD list is not the customer's: nothing applies.
    expect(line.unitPrice).toBeNull();
  });

  it('outside the validity window, or once inactive, the list stops applying', async () => {
    const [before] = await resolver.resolve(organizationId, ctx(wholesaleCustomer, 'DOP', '2025-06-01'), [{ productId: product, quantity: 1 }]);
    expect(before.unitPrice).toBeNull(); // the 2025 list is not this customer's nor a default
    await ds.query(`UPDATE price_lists SET status = 'Inactive' WHERE id = $1`, [wholesaleList]);
    try {
      const [line] = await resolver.resolve(organizationId, ctx(wholesaleCustomer), [{ productId: product, quantity: 1 }]);
      expect(line).toMatchObject({ unitPrice: 115, priceListName: 'QA General' });
    } finally {
      await ds.query(`UPDATE price_lists SET status = 'Active' WHERE id = $1`, [wholesaleList]);
    }
  });

  it('for a document being composed, the catalogue fills in what no list carries', async () => {
    const lines = await resolver.priceLines(organizationId, ctx(wholesaleCustomer), [
      { productId: product, quantity: 1 },
      { productId: unlisted, quantity: 1 },
    ]);
    expect(lines.map((l) => [l.source, l.price])).toEqual([
      ['PRICE_LIST', 100],
      ['CATALOGUE', 50],
    ]);
  });

  it('one default per currency, enforced by the database', async () => {
    await expect(list('QA Otra general', 'DOP', { isDefault: true })).rejects.toThrow(/UQ_price_lists_default_currency/);
  });
});
