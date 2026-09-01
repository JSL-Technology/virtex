import {
  IsUUID,
  IsArray,
  ValidateNested,
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  Length,
  ArrayMinSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaxTreatment } from '../entities/invoice-line-item.entity';
import { PaymentMethod } from '../entities/invoice.entity';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

export class InvoiceLineDto {
  /**
   * Catalogue item, when the line bills one.
   *
   * Optional: requiring it made it impossible to invoice a service, a freight charge or any
   * concept that is not stocked, which excludes every services business the product is sold to.
   * A line with no product must carry its own description and price.
   */
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  /** Fractional quantities are the ordinary case: hours, kilos, litres, partial packs. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  quantity: number;

  /** Overrides the catalogue price. Absent, the item's own price is used. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  /** Line discount as a fraction: 0.10 is 10 %. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(0.999999)
  @IsOptional()
  discountRate?: number;

  /**
   * Overrides the item's tax classification — an export line on a normally taxed good, say.
   * The RATE is never taken from the request: it is derived from the treatment and the catalogue,
   * and validated against the market's legal rates.
   */
  @IsEnum(TaxTreatment)
  @IsOptional()
  taxTreatment?: TaxTreatment;

  /**
   * Explicit rate, for the markets whose base is sub-national and therefore cannot be derived
   * (United States, Brazil). Where a national rate exists it is still validated against it.
   */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  @IsOptional()
  taxRate?: number;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  unitOfMeasure?: string;

  /** Overrides the catalogue's goods/service classification for this line. */
  @IsBoolean()
  @IsOptional()
  isService?: boolean;
}

export class CreateInvoiceDto {
  @IsUUID()
  customerId: string;

  @IsDateString()
  issueDate: string;

  @IsDateString()
  dueDate: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lineItems: InvoiceLineDto[];

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  @IsString()
  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;

  /** Discount on the whole document, as a fraction of the post-line-discount subtotal. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(0.999999)
  @IsOptional()
  documentDiscountRate?: number;

  /** Legally mandated service charge (propina legal), as a fraction. 0.10 in the DR. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(0.5)
  @IsOptional()
  serviceChargeRate?: number;

  /** Share of the output tax the buyer withholds at source (ITBIS retenido). */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  @IsOptional()
  taxWithholdingRate?: number;

  /** Income tax the buyer withholds at source (ISR retenido), as a fraction of the base. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  @IsOptional()
  incomeTaxWithholdingRate?: number;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  /**
   * Fiscal document type to issue.
   *
   * Absent, the market's adapter chooses — for the Dominican Republic, credit-fiscal or consumo
   * according to the buyer's verified identifier. Present, it must be a type the tenant holds an
   * authorized range for, which is what makes exports (E46), government (E45) and special regimes
   * (E44) issuable at all; previously the type was inferred from the length of a tax id and no
   * other type could ever be produced.
   */
  @IsEnum(NcfType)
  @IsOptional()
  fiscalDocumentType?: NcfType;

  /**
   * Issue the document immediately (default), or leave it as a draft.
   *
   * A draft consumes no fiscal number, posts nothing and can be edited or discarded. Every document
   * used to be issued on creation, so preparing a quote-like invoice burned an e-NCF that the DGII
   * then expected to receive.
   */
  @IsBoolean()
  @IsOptional()
  issue?: boolean;
}
