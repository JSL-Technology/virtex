import { buildSchema, ProductVisionService, validateAnswer } from './product-vision.service';
import type { CatalogContext } from '../../inventory/contracts/product-catalog.contract';

const CATEGORY_A = '11111111-1111-4111-8111-111111111111';
const CATEGORY_B = '22222222-2222-4222-8222-222222222222';

const context: CatalogContext = {
  categories: [
    { id: CATEGORY_A, name: 'Café', path: 'Alimentos › Café' },
    { id: CATEGORY_B, name: 'Limpieza', path: 'Hogar › Limpieza' },
  ],
  units: [
    { symbol: 'UND', category: 'Units' },
    { symbol: 'KG', category: 'Weight' },
  ],
  brands: ['Santo Domingo'],
  standardTaxRate: 0.18,
};

const answer = (overrides: Record<string, unknown> = {}) => ({
  is_product_photo: true,
  name: 'Café molido Santo Domingo 453 g',
  description: 'Café tostado y molido.',
  brand: 'Santo Domingo',
  manufacturer: 'Industrias Banilejas',
  category_id: CATEGORY_A,
  unit_of_measure: 'UND',
  barcode: '7501055363063',
  kind: 'GOOD',
  tax_treatment: 'TAXED',
  attributes: [{ key: 'Peso', value: '453 g' }],
  confidence: {
    name: 0.95,
    description: 0.8,
    brand: 0.97,
    manufacturer: 0.8,
    category: 0.9,
    unit_of_measure: 0.7,
    barcode: 0.92,
    kind: 0.99,
    tax_treatment: 0.6,
  },
  notes: '',
  ...overrides,
});

describe('product vision — schema', () => {
  it('offers only the tenant\'s own categories and units as choices', () => {
    const schema = buildSchema(context) as { properties: Record<string, any> };
    expect(schema.properties['category_id'].anyOf[0].enum).toEqual([CATEGORY_A, CATEGORY_B]);
    expect(schema.properties['unit_of_measure'].enum).toEqual(['UND', 'KG']);
  });

  it('closes every object, as structured outputs require', () => {
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') expect(node.additionalProperties).toBe(false);
      Object.values(node).forEach(walk);
    };
    walk(buildSchema(context));
  });

  it('allows only null as a category when the tenant has none', () => {
    const schema = buildSchema({ ...context, categories: [] }) as { properties: Record<string, any> };
    expect(schema.properties['category_id']).toEqual({ type: 'null' });
  });
});

describe('product vision — validating the answer', () => {
  it('passes a correct answer through', () => {
    const value = validateAnswer(answer(), context);
    expect(value.category_id).toBe(CATEGORY_A);
    expect(value.unit_of_measure).toBe('UND');
    expect(value.attributes).toEqual([{ key: 'Peso', value: '453 g' }]);
  });

  it('drops a category that is not one of the tenant\'s', () => {
    // The schema already forbids it; the server does not trust that it did.
    const value = validateAnswer(answer({ category_id: '33333333-3333-4333-8333-333333333333' }), context);
    expect(value.category_id).toBeNull();
  });

  it('falls back to the default unit when the unit is not in the list', () => {
    expect(validateAnswer(answer({ unit_of_measure: 'BARREL' }), context).unit_of_measure).toBe('UND');
  });

  it('bounds every string to its column and clamps confidences to 0–1', () => {
    const value = validateAnswer(
      answer({ name: 'x'.repeat(400), confidence: { ...answer().confidence, name: 7, brand: -1 } }),
      context,
    );
    expect(value.name).toHaveLength(255);
    expect(value.confidence.name).toBe(1);
    expect(value.confidence.brand).toBe(0);
  });

  it('keeps only the characters a barcode can have', () => {
    expect(validateAnswer(answer({ barcode: '750 1055<script>' }), context).barcode).toBe('7501055script');
  });

  it('rejects something that is not an object at all', () => {
    expect(() => validateAnswer('nope', context)).toThrow();
  });
});

describe('ProductVisionService.suggestFromImage', () => {
  const build = (overrides: { answer?: Record<string, unknown>; duplicates?: unknown[] } = {}) => {
    const catalog = {
      storeImage: jest.fn().mockResolvedValue({
        id: 'img-1',
        sha256: 'a'.repeat(64),
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        data: Buffer.from('jpeg'),
      }),
      catalogContext: jest.fn().mockResolvedValue(context),
      findLikelyDuplicates: jest.fn().mockResolvedValue(overrides.duplicates ?? []),
      describeProducts: jest.fn().mockResolvedValue([]),
      pricingHint: jest.fn().mockResolvedValue({ typicalMarkup: 1.4, sampleSize: 12 }),
    };
    const gateway = {
      structured: jest.fn().mockImplementation(async (request) => ({
        value: request.validate(answer(overrides.answer)),
        requestId: 'req-1',
        model: 'claude-opus-5-5',
      })),
    };
    const embeddings = { embedImage: jest.fn().mockResolvedValue(null), nearestProducts: jest.fn() };
    const reference = { source: 'open_food_facts', name: 'Café molido', brand: 'Santo Domingo', quantity: '453 g', imageUrl: null, url: 'u' };
    const barcodes = { external: jest.fn().mockResolvedValue(reference) };
    const service = new ProductVisionService(gateway as never, catalog as never, embeddings as never, barcodes as never);
    return { service, catalog, gateway, embeddings, barcodes };
  };

  const upload = { fileName: 'cafe.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('raw') };

  it('returns a suggestion and creates no product', async () => {
    const { service, catalog } = build();
    const suggestion = await service.suggestFromImage('org-1', 'user-1', upload);
    expect(suggestion.name.value).toBe('Café molido Santo Domingo 453 g');
    expect(suggestion.categoryId.value).toBe(CATEGORY_A);
    expect(suggestion.imageId).toBe('img-1');
    // The tenant's standard rate, because the suggestion is TAXED.
    expect(suggestion.taxRate).toBe(0.18);
    expect(suggestion.pricing).toEqual({ typicalMarkup: 1.4, sampleSize: 12 });
    expect(suggestion.manufacturer).toEqual({ value: 'Industrias Banilejas', confidence: 0.8 });
    expect(catalog.storeImage).toHaveBeenCalledWith('org-1', 'user-1', upload);
  });

  it('asks the public reference only for a valid barcode that is not already in the catalogue', async () => {
    const fresh = build();
    expect((await fresh.service.suggestFromImage('org-1', 'user-1', upload)).reference?.source).toBe('open_food_facts');
    expect(fresh.barcodes.external).toHaveBeenCalledWith('7501055363063');

    const known = build({ duplicates: [{ id: 'p-1', name: 'Café', reason: 'barcode', similarity: 1 }] });
    expect((await known.service.suggestFromImage('org-1', 'user-1', upload)).reference).toBeNull();
    const misread = build({ answer: { barcode: '7501055363064' } });
    await misread.service.suggestFromImage('org-1', 'user-1', upload);
    expect(known.barcodes.external).not.toHaveBeenCalled();
    expect(misread.barcodes.external).not.toHaveBeenCalled();
  });

  it('withdraws confidence from a barcode that fails its own check digit', async () => {
    const { service, catalog } = build({ answer: { barcode: '7501055363064' } });
    const suggestion = await service.suggestFromImage('org-1', 'user-1', upload);
    expect(suggestion.barcode.check).toBe('invalid');
    expect(suggestion.barcode.confidence).toBe(0);
    // And it is not used to look for duplicates: a wrong code would match the wrong product.
    expect(catalog.findLikelyDuplicates).toHaveBeenCalledWith('org-1', expect.objectContaining({ barcode: null }));
  });

  it('passes on the products it may already be', async () => {
    const duplicate = { id: 'p-1', name: 'Café Santo Domingo', reason: 'barcode', similarity: 1 };
    const { service } = build({ duplicates: [duplicate] });
    const suggestion = await service.suggestFromImage('org-1', 'user-1', upload);
    expect(suggestion.possibleDuplicates).toEqual([duplicate]);
  });

  it('sends the photo and the tenant vocabulary, and fingerprints the input', async () => {
    const { service, gateway } = build();
    await service.suggestFromImage('org-1', 'user-1', upload);
    const request = gateway.structured.mock.calls[0][0];
    expect(request.feature).toBe('product_vision');
    expect(request.inputFingerprint).toBe('a'.repeat(64));
    expect(request.content[0].type).toBe('image');
    expect(request.content[1].text).toContain('Alimentos › Café');
    // The system prompt carries nothing tenant-specific, so it can be served from the cache.
    expect(request.system).not.toContain(CATEGORY_A);
  });
});
