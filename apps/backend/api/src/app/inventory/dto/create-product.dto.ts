
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
} from 'class-validator';
import { ProductKind, ProductStatus } from '../entities/product.entity';

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

  @IsNumber()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  price: number;
  
  @IsNumber()
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
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
}