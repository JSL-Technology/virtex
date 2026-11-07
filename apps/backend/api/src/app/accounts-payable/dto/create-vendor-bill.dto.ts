
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
  MaxLength,
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

  @IsDateString()
  dueDate: string;

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

  @IsString()
  @IsOptional()
  ncf?: string;

  @IsString()
  @IsOptional()
  ncfModified?: string;

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

  /** DGII 606 "Tipo de Bienes y Servicios Comprados". */
  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'validation.constraints.length|{"min":2,"max":2}' })
  purchaseCategory?: string;

  /** DGII 606 "Tipo de Retención en ISR". */
  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'validation.constraints.length|{"min":2,"max":2}' })
  isrRetentionType?: string;

  /**
   * The supplier's documents uploaded while the bill was entered (`POST /accounts-payable/capture`
   * or `/attachments`). They become the bill's evidence when it is saved.
   */
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  @IsOptional()
  attachmentIds?: string[];

  /** DGII "Forma de Pago". */
  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'validation.constraints.length|{"min":2,"max":2}' })
  paymentForm?: string;
}