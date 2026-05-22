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
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}