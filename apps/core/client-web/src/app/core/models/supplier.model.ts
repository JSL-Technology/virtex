/**
 * A supplier's fiscal classification: the fact that decides what is withheld when we pay them.
 *
 * The same five values the customer record carries, because withholding regimes are written
 * against one set of classifications regardless of which side of the transaction a party is on.
 */
export type SupplierTaxpayerType =
  | 'INDIVIDUAL'
  | 'COMPANY'
  | 'WITHHOLDING_AGENT'
  | 'GOVERNMENT'
  | 'FOREIGN';

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  /** Which identifier `taxId` holds — `RNC`, `CEDULA`, `NIT`, `CNPJ`… from the catalogue. */
  identityDocumentTypeCode?: string | null;
  /** The issuing country of that document: the SUPPLIER's, which for a payment abroad is not ours. */
  identityDocumentCountry?: string | null;
  address?: string;
  /**
   * ISO 3166-1 alpha-2.
   *
   * The column has existed for as long as the 609 report has needed to separate a domestic
   * purchase from a payment abroad; the model did not declare it and no DTO carried it, so the
   * supplier form had no way to set it.
   */
  country?: string | null;
  /**
   * Assigned by the tax authority, recorded by the tenant, never inferred.
   *
   * Null means unclassified, and nothing is withheld automatically.
   */
  taxpayerType?: SupplierTaxpayerType | null;
  /** Commercial terms (CMP-17). */
  paymentTermDays?: number | null;
  currencyCode?: string | null;
  defaultExpenseAccountId?: string | null;
  status?: 'ACTIVE' | 'BLOCKED';
  blockedReason?: string | null;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Where a supplier is paid (CMP-17). The number never comes back: only its last four digits. */
export interface SupplierBankAccount {
  id: string;
  bankName: string;
  accountHolder: string | null;
  accountType: 'CHECKING' | 'SAVINGS';
  accountLast4: string;
  currencyCode: string | null;
  swift: string | null;
  iban: string | null;
  isDefault: boolean;
}
