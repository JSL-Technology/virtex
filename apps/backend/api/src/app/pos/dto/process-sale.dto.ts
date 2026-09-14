import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PosSaleItemDto {
  @IsString()
  productId: string;

  @IsString()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  productName: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  price: number;

  @IsNumber()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  quantity: number;
}

export class ProcessSaleDto {
  @IsString()
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  terminalId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ValidateNested({ each: true })
  @Type(() => PosSaleItemDto)
  items: PosSaleItemDto[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  subtotal: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  tax: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  total: number;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'validation.constraints.max_length|{"max":60}' })
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  customerName?: string;
}
