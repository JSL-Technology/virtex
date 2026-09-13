
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsEnum,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ProductStatus } from '../entities/product.entity';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":255}' })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(50, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":50}' })
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
  @IsUUID('4', { message: 'VALIDATION.PRODUCT_CATEGORY.PARENT_MUST_BE_UUID' })
  @IsOptional()
  categoryId?: string | null;

  @IsNumber()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  price: number;
  
  @IsNumber()
  @IsOptional()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  cost?: number;

  @IsNumber()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  stock: number;

  @IsNumber()
  @IsOptional()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  reorderLevel?: number;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;
}