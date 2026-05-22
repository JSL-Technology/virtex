export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  address?: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}