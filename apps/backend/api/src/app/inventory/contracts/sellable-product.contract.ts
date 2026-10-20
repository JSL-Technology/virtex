import { EntityManager } from 'typeorm';
import { Product, ProductKind, ProductStatus } from '../entities/product.entity';

/**
 * What a sales channel needs to know to price one line: the catalogue's own answer, never the
 * till's.
 *
 * Inventory owns the product table; a channel (the POS, a storefront) reads it through this
 * contract instead of importing the entity, so how Inventory stores price and tax can change
 * without every channel changing with it.
 */
export interface SellableProduct {
  id: string;
  name: string;
  /** Unit price before tax, as the catalogue holds it. */
  price: number;
  /** The rate the line is taxed at: 0 unless the product is taxed. */
  taxRate: number;
  /** Whether selling it moves stock. Services do not. */
  stocked: boolean;
}

/**
 * The product, if the tenant sells it right now; `null` if it does not exist in the tenant's
 * catalogue or is inactive. Read through the caller's manager so it joins the sale's transaction.
 */
export async function findSellableProduct(
  manager: EntityManager,
  organizationId: string,
  productId: string,
): Promise<SellableProduct | null> {
  const product = await manager.findOne(Product, { where: { id: productId, organizationId } });
  if (!product || product.status !== ProductStatus.ACTIVE) return null;
  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    taxRate: effectiveProductTaxRate(product, await standardSalesTaxRate(manager, organizationId)),
    stocked: product.kind !== ProductKind.SERVICE,
  };
}

/**
 * The tenant's standard consumption-tax rate, as a fraction: the highest percentage rate in its
 * tax list (ITBIS 18 % in the Dominican Republic, IVA 16 % in Mexico). Zero where none is set up.
 *
 * Read from the tenant's own `taxes`, which provisioning fills from the country's scheme and the
 * tenant may edit, so the answer is the one the rest of the product shows them.
 */
export async function standardSalesTaxRate(
  manager: EntityManager,
  organizationId: string,
): Promise<number> {
  const rows: Array<{ rate: string | number | null }> = await manager.query(
    `SELECT MAX(rate) AS rate FROM taxes WHERE organization_id = $1 AND type = 'Porcentaje'`,
    [organizationId],
  );
  const percent = Number(rows[0]?.rate ?? 0);
  return Number.isFinite(percent) && percent > 0 ? percent / 100 : 0;
}

/**
 * The rate a product is taxed at — ONE rule for every channel (QA C-08).
 *
 * `TAXED` with its own rate uses it; `TAXED` with no rate (every product created before the form
 * asked for one — the column defaulted to 0) uses the tenant's standard rate, because "taxed at
 * zero" is what the ZERO_RATED treatment is for and cannot be what a taxed product means. Any other
 * treatment is untaxed. The till and the server used to disagree exactly here: the till applied
 * 18 %, the server 0 %, and every sale was refused as "totals changed".
 */
export function effectiveProductTaxRate(
  product: Pick<Product, 'taxTreatment' | 'taxRate'>,
  standardRate: number,
): number {
  if ((product.taxTreatment ?? 'TAXED') !== 'TAXED') return 0;
  const own = Number(product.taxRate);
  return Number.isFinite(own) && own > 0 ? own : standardRate;
}

/** One item as a till shows it: what it is, what it costs, and how it is taxed — already resolved. */
export interface SellableCatalogueItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** Unit price before tax. */
  price: number;
  /**
   * The rate the server will tax the line at, already resolved by {@link effectiveProductTaxRate}.
   * Sending the resolved rate (rather than treatment + own rate) is what keeps a till from ever
   * pricing a line differently from the server that will accept or refuse it.
   */
  taxRate: number;
  kind: ProductKind;
  /** On hand across the company. Services report 0 and are never out of stock. */
  stock: number;
  unitOfMeasure: string;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

/** The most a till downloads at once. A shop with more than this sells by search and barcode. */
export const SELLABLE_CATALOGUE_LIMIT = 5000;

/**
 * Everything the tenant sells right now, priced and taxed the way the sale will be.
 *
 * The till used to read `GET /inventory` — the back office's product list, behind `products:view`
 * — and re-derive the tax rule in the browser. A cashier therefore needed a catalogue-management
 * permission to sell, and two copies of the tax rule had to agree forever.
 */
export async function listSellableCatalogue(
  manager: EntityManager,
  organizationId: string,
): Promise<SellableCatalogueItem[]> {
  const [products, standardRate] = await Promise.all([
    manager
      .createQueryBuilder(Product, 'product')
      .leftJoinAndSelect('product.category', 'category')
      .where('product.organizationId = :organizationId', { organizationId })
      .andWhere('product.status = :status', { status: ProductStatus.ACTIVE })
      .orderBy('product.name', 'ASC')
      .take(SELLABLE_CATALOGUE_LIMIT)
      .getMany(),
    standardSalesTaxRate(manager, organizationId),
  ]);
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku ?? null,
    barcode: product.barcode ?? null,
    price: Number(product.price),
    taxRate: effectiveProductTaxRate(product, standardRate),
    kind: product.kind,
    stock: product.kind === ProductKind.SERVICE ? 0 : Number(product.stock ?? 0),
    unitOfMeasure: product.unitOfMeasure,
    imageUrl: product.imageUrl ?? null,
    categoryId: product.categoryId ?? null,
    categoryName: product.category?.name ?? null,
  }));
}

/**
 * Whether selling this product moved stock — the question a void asks to put it back. Answered
 * for inactive products too: a product withdrawn after the sale still has to be restocked.
 */
export async function isStockedProduct(
  manager: EntityManager,
  organizationId: string,
  productId: string,
): Promise<boolean> {
  const product = await manager.findOne(Product, {
    where: { id: productId, organizationId },
    select: ['id', 'kind'],
  });
  return product !== null && product.kind !== ProductKind.SERVICE;
}
