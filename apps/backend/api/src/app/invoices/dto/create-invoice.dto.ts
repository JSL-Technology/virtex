
import {
  IsUUID,
  IsArray,
  ValidateNested,
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

class LineItemDto {
  @IsUUID()
  productId: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  taxRate?: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  customerId: string;

  @IsDateString()
  issueDate: string;

  @IsDateString()
  dueDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems: LineItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;


  @IsString()
  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;
}