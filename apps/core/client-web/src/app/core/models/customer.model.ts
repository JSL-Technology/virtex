// app/core/models/customer.model.ts
export interface Customer {
  id: string;
  companyName: string;
  contactPerson?: string;
  email: string;
  phone: string;
  taxId?: string;
  address?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  country: string;
  totalBilled: number;
  createdAt: Date;
  updatedAt: Date;
  organizationId: string;
}