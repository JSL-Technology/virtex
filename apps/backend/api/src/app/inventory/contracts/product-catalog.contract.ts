/**
 * What another module may ask of the product catalogue in order to help somebody fill it in.
 *
 * The AI module proposes products from photos; it does not own products, their images or their
 * categories. This port is the catalogue's answer to the four questions it needs answered, so the
 * rules about what a valid category, unit or barcode is stay where the catalogue keeps them.
 */

/** An uploaded photo, normalised and stored. `data` is the normalised JPEG, for analysis. */
export interface StoredProductImage {
  id: string;
  sha256: string;
  mimeType: string;
  width: number;
  height: number;
  data: Buffer;
}

export interface ProductImageUpload {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

/** The tenant's own vocabulary: what a proposed product may be filed under. */
export interface CatalogContext {
  categories: Array<{ id: string; name: string; path: string }>;
  units: Array<{ symbol: string; category: string }>;
  /** Brands already in the catalogue, most used first — so a proposal reuses the tenant's spelling. */
  brands: string[];
  /** The tenant's standard consumption-tax rate, as a fraction. 0 when none is set up. */
  standardTaxRate: number;
}

export interface ProductMatch {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  imageUrl: string | null;
  reason: 'barcode' | 'name' | 'image';
  /** 0–1. 1 for an identical barcode. */
  similarity: number;
}

/** A price derived from the tenant's own numbers — never from a model. */
export interface PricingHint {
  /** Median of price ÷ cost over the category's products that have both. */
  typicalMarkup: number | null;
  sampleSize: number;
}

export abstract class ProductCatalogPort {
  /** Validates the bytes are a real image, strips its metadata, normalises it and stores it. */
  abstract storeImage(
    organizationId: string,
    userId: string | null,
    upload: ProductImageUpload,
  ): Promise<StoredProductImage>;

  abstract catalogContext(organizationId: string): Promise<CatalogContext>;

  abstract findLikelyDuplicates(
    organizationId: string,
    probe: { barcode?: string | null; name?: string | null; brand?: string | null },
  ): Promise<ProductMatch[]>;

  /** The tenant's products with these ids, as matches with no reason yet. Unknown ids are skipped. */
  abstract describeProducts(organizationId: string, ids: string[]): Promise<ProductMatch[]>;

  abstract pricingHint(organizationId: string, categoryId: string | null): Promise<PricingHint>;
}
