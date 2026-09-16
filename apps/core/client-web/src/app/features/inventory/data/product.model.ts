export interface Product {
  id: string;
  name: string;
  sku?: string;
  description?: string;
  /**
   * The tenant's own category.
   *
   * Was a free-text string chosen from three options written into the product form's template.
   * `categoryId` is what is sent; `category` is the row the server joins back, so a register can
   * print the name without a second request.
   */
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  price: number;
  cost: number;
  stock: number;
  reorderLevel?: number;
  imageUrl?: string;
  status: 'Active' | 'Inactive';

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
