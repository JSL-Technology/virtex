import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductCatalogPort, ProductMatch } from '../../inventory/contracts/product-catalog.contract';
import { checkGtin, GtinCheck } from './gtin';

/** What a public product database says about a barcode. Shown as a reference, never saved as-is. */
export interface ExternalProductReference {
  source: 'open_food_facts';
  name: string | null;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
  url: string;
}

export interface BarcodeLookup {
  code: string;
  check: GtinCheck;
  /** Products of this tenant that already carry the barcode. */
  existing: ProductMatch[];
  reference: ExternalProductReference | null;
}

const LOOKUP_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5_000;

/**
 * A barcode, read by the camera or from a photo, turned into what is known about it.
 *
 * The tenant's own catalogue first: a code already on a product is that product, and creating it
 * again is the duplicate the form exists to prevent. Then, only when the deployment enabled it and
 * the code passed its check digit, Open Food Facts — the barcode is all that leaves the server,
 * with a short timeout, and a public answer is cached for a day because it is the same for every
 * tenant. A lookup that fails is just no reference: scanning works the same without it.
 */
@Injectable()
export class BarcodeLookupService {
  private readonly logger = new Logger(BarcodeLookupService.name);
  private readonly cache = new Map<string, { at: number; value: ExternalProductReference | null }>();

  constructor(
    private readonly config: ConfigService,
    private readonly catalog: ProductCatalogPort,
  ) {}

  async lookup(organizationId: string, raw: string): Promise<BarcodeLookup> {
    const code = (raw ?? '').replace(/[^0-9A-Za-z-]/g, '').slice(0, 64);
    const check = checkGtin(code);
    const existing = code
      ? (await this.catalog.findLikelyDuplicates(organizationId, { barcode: code })).filter((m) => m.reason === 'barcode')
      : [];
    const reference = !existing.length && check === 'valid' ? await this.external(code) : null;
    return { code, check, existing, reference };
  }

  async external(code: string): Promise<ExternalProductReference | null> {
    if (this.config.get<boolean>('AI_OPEN_FOOD_FACTS_ENABLED') !== true || checkGtin(code) !== 'valid') return null;
    const hit = this.cache.get(code);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const base = (this.config.get<string>('AI_OPEN_FOOD_FACTS_URL') ?? 'https://world.openfoodfacts.org').replace(/\/$/, '');
    let value: ExternalProductReference | null = null;
    try {
      const response = await fetch(
        `${base}/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_es,brands,quantity,image_front_small_url`,
        { headers: { 'User-Agent': 'VirtexERP/1.0 (product catalogue lookup)' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
      );
      if (response.ok) {
        const body = (await response.json()) as { status?: number; product?: Record<string, unknown> };
        if (body.status === 1 && body.product) value = toReference(code, body.product, base);
      } else if (response.status !== 404) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      // Not cached: a network failure says nothing about the product.
      this.logger.debug(`Open Food Facts lookup failed for a barcode: ${(error as Error).message}`);
      return null;
    }
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(code, { at: Date.now(), value });
    return value;
  }
}

function toReference(code: string, product: Record<string, unknown>, base: string): ExternalProductReference | null {
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const name = str(product['product_name_es'], 255) ?? str(product['product_name'], 255);
  const brand = str(typeof product['brands'] === 'string' ? (product['brands'] as string).split(',')[0] : null, 120);
  if (!name && !brand) return null;
  const image = str(product['image_front_small_url'], 500);
  return {
    source: 'open_food_facts',
    name,
    brand,
    quantity: str(product['quantity'], 60),
    imageUrl: image && /^https:\/\//.test(image) ? image : null,
    url: `${base}/product/${encodeURIComponent(code)}`,
  };
}
