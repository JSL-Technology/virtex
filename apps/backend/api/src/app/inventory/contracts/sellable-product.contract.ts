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
    taxRate: product.taxTreatment === 'TAXED' ? Number(product.taxRate) : 0,
    stocked: product.kind !== ProductKind.SERVICE,
  };
}
