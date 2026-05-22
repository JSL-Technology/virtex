import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNotEmpty, IsNumber, IsString, IsUUID, Min, ValidateNested, IsOptional, Length } from 'class-validator';

class CreateQuoteLineDto {
  @IsUUID()
  productId: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateQuoteDto {
  @IsUUID()
  customerId: string;

  @IsUUID()
  @IsOptional()
  opportunityId?: string;
  
  @IsDateString()
  issueDate: string;

  @IsDateString()
  expiryDate: string;


  @IsString()
  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;


  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteLineDto)
  lines: CreateQuoteLineDto[];
}