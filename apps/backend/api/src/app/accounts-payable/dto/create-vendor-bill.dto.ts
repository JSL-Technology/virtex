
import { Type } from 'class-transformer';
import { VendorBillLineNature } from '../entities/vendor-bill-line.entity';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  IsObject,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class CreateVendorBillLineDto {
  @IsString()
  @IsNotEmpty()
  product: string; 

  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsNumber()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  unitPrice: number;

  @IsNumber()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  total: number;

  @IsUUID()
  @IsOptional()
  productId?: string; 

  @IsUUID()
  @IsOptional()
  expenseAccountId?: string; 

  /**
   * The purchase-order line this bills (three-way match, QA C-07). Goods already received
   * against it clear "goods received not invoiced" instead of entering stock a second time.
   */
  @IsUUID()
  @IsOptional()
  purchaseOrderLineId?: string;

  /**
   * Goods or services. Optional: a line for a catalogue product takes the product's kind, and a
   * free expense line with nothing stated is a service. Stated, it wins over both — a product kept
   * as a good can be billed as its installation.
   */
  @IsIn(Object.values(VendorBillLineNature))
  @IsOptional()
  nature?: VendorBillLineNature;

  /**
   * The consumption-tax rate of the line, as a fraction (0.18). It must be a rate in force on the
   * bill's date; the bill's tax is computed from it (audit 2026-11-07, CMP-02).
   */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  @IsOptional()
  taxRate?: number;
}

export class CreateVendorBillDto {
  /** The branch that received the bill. Omitted: the person's default branch, else the headquarters. */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsNotEmpty()
  vendorId: string;

  /** The purchase order the bill was raised against, when there is one. */
  @IsUUID()
  @IsOptional()
  purchaseOrderId?: string;

  /**
   * Declared as the string it actually is.
   *
   * The global pipe runs with `enableImplicitConversion`, so a property TYPED `Date` is converted
   * from the wire string into a `Date` instance BEFORE the validators run — and `@IsDateString()`
   * then rejects it for not being a string. Every vendor bill the UI sent came back
   * `400 date is not a valid date` with a perfectly valid `2026-09-13` in the body: the module
   * could not record a single purchase. `CreateInvoiceDto` already declares its dates as strings,
   * which is why sales never hit this.
   */
  @IsDateString()
  date: string;

  /** Omitted: the bill date plus the supplier's payment terms (CMP-17). */
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVendorBillLineDto)
  lines: CreateVendorBillLineDto[];

  /**
   * The document total, checked against the lines and the tax breakdown rather than stored as
   * given. It used to be persisted verbatim, so the books recorded whatever the caller claimed the
   * arithmetic was.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  total?: number;

  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  /**
   * The number the authority assigned to the supplier's document, checked by the market's own rule
   * (`MarketPurchases.receivedDocument`). It was `ncf`, the DGII's name for it, everywhere.
   */
  @IsString()
  @IsOptional()
  supplierFiscalNumber?: string;

  /** The number of the supplier's document this one modifies, on a note they issued. */
  @IsString()
  @IsOptional()
  modifiedSupplierFiscalNumber?: string;

  /** The number on the supplier's own document; one live bill per supplier and number. */
  @IsString()
  @IsOptional()
  @MaxLength(60, { message: 'validation.constraints.max_length|{"max":60}' })
  supplierInvoiceNumber?: string;

  /**
   * A bill with neither an NCF nor a supplier number that matches a live one of the same supplier,
   * date, currency and total is refused as a probable duplicate; this records it anyway, once the
   * person has confirmed it is a different document.
   */
  @IsBoolean()
  @IsOptional()
  allowPossibleDuplicate?: boolean;

  // ── Fiscal breakdown ──────────────────────────────────────────────────────
  //
  // `VendorBill` has modelled all of this for the DGII 606 since the reporting work, and no DTO
  // ever accepted it — so every field was stored at its default of zero, the 606 reported zeros,
  // and the ledger entry had no tax lines to post.

  /** Consumption tax borne on the purchase (ITBIS/IVA facturado). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  taxAmount?: number;

  /** Consumption tax withheld from the supplier and owed to the authority. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  taxWithheld?: number;

  /** Income tax withheld from the supplier. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  incomeTaxWithheld?: number;

  /**
   * Why this bill withholds something other than what the supplier's regime produces.
   *
   * Both withholdings above are now resolved on the server from the supplier's fiscal
   * classification. Stating different figures is allowed — a market this product does not model, a
   * designation that changed this morning — but not silently: without a reason the bill is
   * refused, and with one the reason is recorded on the document.
   */
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  withholdingOverrideReason?: string;

  /**
   * Why the bill's tax differs from what its lines' rates produce (beyond rounding) — a supplier
   * error being claimed, an exempt item the line does not show. Recorded on the bill (CMP-02).
   */
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  taxOverrideReason?: string;

  /** Consumption tax that cannot be deducted and is carried to cost. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  taxToCost?: number;

  /** Consumption tax subject to the proportionality rule. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  taxProportional?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  exciseAmount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  otherTaxes?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  serviceCharge?: number;

  /**
   * Split of the taxable base, which the 606 reports separately.
   *
   * Derived from the lines when neither is sent. Sent, the two must add up to the subtotal (one
   * alone takes the rest of it as the other): the bill used to default the WHOLE subtotal to
   * services, so a purchase of goods was withheld ISR it did not owe and reported as services.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  goodsAmount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  servicesAmount?: number;

  /**
   * What this market's authority asks about the purchase, by the keys the market declares
   * (`MarketPurchases.fiscalAttributes`). Checked against that schema in the service: a key the
   * market does not ask for is refused, so nothing arbitrary reaches the column.
   *
   * Three fields here took DGII codes — the 606's kind of goods and services, its kind of
   * income-tax withholding and its «forma de pago» — from a tenant of any market.
   */
  @IsObject()
  @IsOptional()
  fiscalAttributes?: Record<string, unknown>;

  /**
   * The supplier's documents uploaded while the bill was entered (`POST /accounts-payable/capture`
   * or `/attachments`). They become the bill's evidence when it is saved.
   */
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  @IsOptional()
  attachmentIds?: string[];

  /** Which of the company's payment methods settled it (`payment_methods.code`). */
  @IsString()
  @IsOptional()
  @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  paymentMethodCode?: string;
}