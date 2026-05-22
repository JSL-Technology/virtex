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
}

export interface PriceList {
  id: string;
  name: string;
  currency: string;
  validFrom: Date;
  validTo: Date;
  status: PriceListStatus;
  items: PriceListItem[];
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}
