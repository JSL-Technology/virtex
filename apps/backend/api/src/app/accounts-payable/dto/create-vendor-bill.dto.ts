
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  unitPrice: number;

  @IsNumber()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  total: number;

  @IsUUID()
  @IsOptional()
  productId?: string; 

  @IsUUID()
  @IsOptional()
  expenseAccountId?: string; 
}

export class CreateVendorBillDto {
  @IsUUID()
  @IsNotEmpty()
  vendorId: string;

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
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @IsOptional()
  total?: number;

  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsString()
  @IsOptional()
  ncf?: string;

  @IsString()
  @IsOptional()
  ncfModified?: string;

  // ── Fiscal breakdown ──────────────────────────────────────────────────────
  //
  // `VendorBill` has modelled all of this for the DGII 606 since the reporting work, and no DTO
  // ever accepted it — so every field was stored at its default of zero, the 606 reported zeros,
  // and the ledger entry had no tax lines to post.

  /** Consumption tax borne on the purchase (ITBIS/IVA facturado). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  taxAmount?: number;

  /** Consumption tax withheld from the supplier and owed to the authority. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  taxWithheld?: number;

  /** Income tax withheld from the supplier. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  incomeTaxWithheld?: number;

  /** Consumption tax that cannot be deducted and is carried to cost. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  taxToCost?: number;

  /** Consumption tax subject to the proportionality rule. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  taxProportional?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  exciseAmount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  otherTaxes?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  serviceCharge?: number;

  /** Split of the taxable base, which the 606 reports separately. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  goodsAmount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  servicesAmount?: number;

  /** DGII 606 "Tipo de Bienes y Servicios Comprados". */
  @IsString()
  @IsOptional()
  @Length(2, 2)
  purchaseCategory?: string;

  /** DGII 606 "Tipo de Retención en ISR". */
  @IsString()
  @IsOptional()
  @Length(2, 2)
  isrRetentionType?: string;

  /** DGII "Forma de Pago". */
  @IsString()
  @IsOptional()
  @Length(2, 2)
  paymentForm?: string;
}