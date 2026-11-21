// app/core/models/price-list.model.ts
import { Product } from './product.model';

export enum PriceListStatus {
  DRAFT = 'Draft',
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

export interface PriceListItem {
  id: string;
  product: Product;
  productId: string;
  price: number;
  /** The quantity from which this price applies (quantity breaks). */
  minQuantity: number;
}

export interface PriceList {
  id: string;
  name: string;
  currency: string;
  validFrom: Date;
  validTo: Date;
  status: PriceListStatus;
  /** The list for every customer without one, in this currency. */
  isDefault: boolean;
  items: PriceListItem[];
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One line priced for a document being composed (`POST /price-lists/resolve`). */
export interface PricedLine {
  productId: string;
  quantity: number;
  /** `PRICE_LIST`, `CATALOGUE`, or `NONE` when the product has no price anywhere. */
  source: 'PRICE_LIST' | 'CATALOGUE' | 'NONE';
  price: number | null;
  priceListId: string | null;
  priceListName: string | null;
  minQuantity: number | null;
}

export interface ResolvePricesRequest {
  customerId?: string | null;
  currencyCode?: string | null;
  date?: string | null;
  lines: Array<{ productId: string; quantity: number }>;
}
