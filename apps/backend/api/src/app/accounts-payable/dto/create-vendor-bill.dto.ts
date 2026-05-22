
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
  @Min(0)
  unitPrice: number;

  @IsNumber()
  @Min(0)
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

  @IsDateString()
  date: Date;

  @IsDateString()
  dueDate: Date;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVendorBillLineDto)
  lines: CreateVendorBillLineDto[];

  @IsNumber()
  @Min(0)
  total: number;


  @IsString()
  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;
}