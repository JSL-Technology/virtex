/**
 * The purchases a tax return declares, asked for without knowing who keeps them.
 *
 * The DGII returns live in Sales' compliance module, and the 606 and 609 are about purchases:
 * Compliance read `VendorBill` — and then `VendorDebitNote` — straight out of Purchasing, an edge
 * the module map forbids (`ventas` may not depend on `compras`). The question travels through this
 * contract now and is answered by the owner of the documents, who knows which states count as
 * issued and how a credit note splits between goods and services.
 *
 * Plain data only: dates as `YYYY-MM-DD`, amounts as numbers in the document's currency.
 */
export interface PurchaseFiscalQuery {
  readonly organizationId: string;
  /** First day of the period, inclusive. */
  readonly from: string;
  /** Last day of the period, inclusive. */
  readonly to: string;
}

export type PurchaseFiscalDocumentKind = 'bill' | 'credit_note';

/** One supplier comprobante, with every figure a purchases return reports. */
export interface PurchaseFiscalDocument {
  readonly kind: PurchaseFiscalDocumentKind;
  /** The product's own number for it, to name it in an error a person must act on. */
  readonly reference: string;
  readonly supplierName: string | null;
  readonly supplierTaxId: string | null;
  /** ISO 3166-1 alpha-2 country where the supplier is established; null when not recorded. */
  readonly supplierCountry: string | null;
  readonly fiscalNumber: string | null;
  /** The comprobante this one modifies: a credit note's bill, a bill's corrected original. */
  readonly modifiedFiscalNumber: string | null;
  readonly date: string;
  readonly paidOn: string | null;
  /** DGII «tipo de bienes y servicios comprados». */
  readonly purchaseCategory: string | null;
  /** DGII «forma de pago». A credit note's is `06`. */
  readonly paymentForm: string | null;
  readonly servicesAmount: number;
  readonly goodsAmount: number;
  readonly taxAmount: number;
  readonly taxWithheld: number;
  readonly taxProportional: number;
  readonly taxToCost: number;
  readonly incomeTaxWithheld: number;
  readonly isrRetentionType: string | null;
  readonly exciseAmount: number;
  readonly otherTaxes: number;
  readonly serviceCharge: number;
  readonly total: number;
}

export interface PurchaseFiscalRecordsSource {
  /** Stable identifier of the answering module. Never shown. */
  readonly sourceName: string;

  /**
   * Every comprobante with a fiscal number received in the period — bills and the credit notes
   * issued against them — excluding drafts, rejected bills and anything voided, in date order.
   */
  fiscalDocuments(query: PurchaseFiscalQuery): Promise<PurchaseFiscalDocument[]>;

  /**
   * Bills from suppliers established outside `homeCountry`, fiscal number or not, excluding
   * drafts, rejected and voided ones, in date order. A supplier with no country recorded counts as
   * domestic.
   */
  foreignPurchases(query: PurchaseFiscalQuery, homeCountry: string): Promise<PurchaseFiscalDocument[]>;

  /**
   * Bills PAID in the period on which the company withheld ISR or ITBIS, whatever their date.
   *
   * Withholdings are declared (IR-17) in the month the payment is made, not the month the bill is
   * dated: a December bill paid in January is January's retention.
   */
  withholdingsPaid(query: PurchaseFiscalQuery): Promise<PurchaseFiscalDocument[]>;
}
