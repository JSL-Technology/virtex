
import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ProductStatus } from '../entities/product.entity';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  sku?: string;

  @IsString()
  @IsOptional()
  description?: string;
  
  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @IsNumber()
  @Min(0)
  price: number;
  
  @IsNumber()
  @IsOptional()
  @Min(0)
  cost?: number;

  @IsNumber()
  @Min(0)
  stock: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  reorderLevel?: number;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;
}