
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsEnum,
  IsUUID,
  MaxLength,
  Max,
  IsIn,
  IsArray,
  ArrayMaxSize,
  IsObject,
  Matches,
} from 'class-validator';
import { ProductKind, ProductStatus } from '../entities/product.entity';

/** The largest unit price or cost a product's numeric(18,6) columns hold. */
export const MAX_UNIT_AMOUNT = 999_999_999_999;

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(50, { message: 'validation.constraints.max_length|{"max":50}' })
  sku?: string;

  @IsString()
  @IsOptional()
  description?: string;
  
  /**
   * The tenant's category, by id.
   *
   * Was a free-text `category`, which is why the same catalogue could hold `Electrónica` and
   * `Electronics` as two different things. `null` files the product under nothing, which is a
   * normal state.
   */
  @IsUUID('4', { message: 'validation.product_category.parent_must_be_uuid' })
  @IsOptional()
  categoryId?: string | null;

  // The columns are numeric(18,6): twelve integer digits. Past that the database refused the
  // row with «a numeric value is out of range» and no word of which one (QA R3-M15).
  @IsNumber()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(MAX_UNIT_AMOUNT, { message: `validation.constraints.max|{"max":${MAX_UNIT_AMOUNT}}` })
  price: number;

  @IsNumber()
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(MAX_UNIT_AMOUNT, { message: `validation.constraints.max|{"max":${MAX_UNIT_AMOUNT}}` })
  cost?: number;

  /**
   * What the product is created holding — its opening stock, booked against opening-balance
   * equity. Afterwards the quantity changes only through documents (sales, receipts, adjustments,
   * transfers); see `InventoryService.update`.
   */
  @IsNumber()
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  stock?: number;

  /** Where the opening stock is. Omitted: the company's default warehouse. */
  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @IsNumber()
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  reorderLevel?: number;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  /** A good is counted and moves stock; a service is not. */
  @IsEnum(ProductKind)
  @IsOptional()
  kind?: ProductKind;

  @IsString()
  @IsOptional()
  @MaxLength(16, { message: 'validation.constraints.max_length|{"max":16}' })
  unitOfMeasure?: string;

  /**
   * How the item is treated for consumption tax. The form had no field for it — nor for the rate
   * — so every product was created "taxed at 0 %", which the till read literally (QA C-08).
   */
  @IsIn(['TAXED', 'ZERO_RATED', 'EXEMPT'], { message: 'validation.constraints.is_in' })
  @IsOptional()
  taxTreatment?: 'TAXED' | 'ZERO_RATED' | 'EXEMPT';

  /** A fraction: 0.18, never 18 (QA M-05). Omitted on a taxed item, the tenant's standard rate. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.product.tax_rate_is_a_fraction' })
  @IsOptional()
  taxRate?: number;

  /** The code on the packaging. Digits, letters and dashes: what a scanner reads, nothing else. */
  @IsString()
  @IsOptional()
  @MaxLength(64, { message: 'validation.constraints.max_length|{"max":64}' })
  @Matches(/^[0-9A-Za-z-]*$/, { message: 'validation.product.barcode_format' })
  barcode?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  brand?: string | null;

  /** Size, colour, weight… free keys; trimmed and bounded by `InventoryService`. */
  @IsObject()
  @IsOptional()
  attributes?: Record<string, string> | null;

  /**
   * Photos uploaded before the product existed — the "create from photo" flow — to attach to it.
   * The first becomes the primary image.
   */
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(8)
  @IsOptional()
  imageIds?: string[];
}
