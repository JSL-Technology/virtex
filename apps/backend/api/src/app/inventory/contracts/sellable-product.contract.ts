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
