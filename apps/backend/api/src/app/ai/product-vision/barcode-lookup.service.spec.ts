import { BarcodeLookupService } from './barcode-lookup.service';

/**
 * A scanned barcode: the tenant's own product first, a public reference only when enabled, and
 * nothing but the barcode ever sent out.
 */
describe('BarcodeLookupService', () => {
  const VALID = '7501055363063';
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const build = (enabled: boolean, existing: unknown[] = []) => {
    const config = { get: (key: string) => (key === 'AI_OPEN_FOOD_FACTS_ENABLED' ? enabled : undefined) };
    const catalog = { findLikelyDuplicates: jest.fn().mockResolvedValue(existing) };
    return { service: new BarcodeLookupService(config as never, catalog as never), catalog };
  };

  const offAnswer = (body: unknown, status = 200) =>
    jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }) as unknown as typeof fetch;

  it('a code already in the catalogue is that product, and nothing leaves the server', async () => {
    global.fetch = offAnswer({});
    const { service } = build(true, [{ id: 'p-1', reason: 'barcode' }, { id: 'p-2', reason: 'name' }]);
    const result = await service.lookup('org-1', VALID);
    expect(result.existing).toEqual([{ id: 'p-1', reason: 'barcode' }]);
    expect(result.reference).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('asks Open Food Facts only when enabled, and only for a code that passes its check digit', async () => {
    global.fetch = offAnswer({ status: 1, product: { product_name: 'Ground coffee', product_name_es: 'Café molido', brands: 'Santo Domingo, Induban', quantity: '453 g', image_front_small_url: 'http://insecure' } });
    const off = build(false);
    expect((await off.service.lookup('org-1', VALID)).reference).toBeNull();
    expect((await build(true).service.lookup('org-1', '7501055363064')).check).toBe('invalid');
    expect(global.fetch).not.toHaveBeenCalled();

    const result = await build(true).service.lookup('org-1', VALID);
    expect(result.reference).toEqual({
      source: 'open_food_facts',
      name: 'Café molido',
      brand: 'Santo Domingo',
      quantity: '453 g',
      imageUrl: null,
      url: `https://world.openfoodfacts.org/product/${VALID}`,
    });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(`/api/v2/product/${VALID}.json`);
  });

  it('an unknown product or an unreachable service is simply no reference', async () => {
    global.fetch = offAnswer({ status: 0 });
    expect((await build(true).service.lookup('org-1', VALID)).reference).toBeNull();
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    expect(await build(true).service.external('4006381333931')).toBeNull();
  });
});
