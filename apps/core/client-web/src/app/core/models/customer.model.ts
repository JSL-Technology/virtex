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
  /**
   * The buyer's fiscal classification, which decides what they withhold at source.
   *
   * The form has offered it for some time and the model never declared it, so every screen that
   * read it had to cast.
   */
  taxpayerType?: string | null;
  /** The terms as they are printed on the document: "Neto 30", "Contado". */
  paymentTerms?: string | null;
  /**
   * How many days after issue this customer's invoices fall due.
   *
   * Null leaves the organization's default in force; zero means due on receipt. Without it every
   * invoice opened due on the day it was issued, and the ageing report called it overdue the next
   * morning.
   */
  paymentTermDays?: number | null;
  totalBilled: number;
  createdAt: Date;
  updatedAt: Date;
  organizationId: string;
}