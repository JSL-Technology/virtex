export interface Product {
  id: string;
  name: string;
  sku?: string;
  description?: string;
  category?: string;
  price: number;
  cost: number;
  stock: number;
  reorderLevel?: number;
  imageUrl?: string;
  status: 'Active' | 'Inactive';

  /**
   * The rest of what the catalogue has carried server-side for some time.
   *
   * The model stopped at `status` while the entity had grown a further eight columns, so every
   * screen that needed a unit, a tax treatment or the goods/services split either cast its way
   * around the type or invented a default. Declaring them here is what lets a purchase order carry
   * the unit the product is actually bought in.
   */
  kind?: 'GOOD' | 'SERVICE';
  unitOfMeasure?: string;
  /** `TAXED`, `EXEMPT`, `ZERO_RATED`… as the fiscal regime names it. */
  taxTreatment?: string;
  /** A fraction, not a percentage: 0.18, never 18. */
  taxRate?: number;
  exciseRate?: number;
  fiscalItemCode?: string | null;

  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}
