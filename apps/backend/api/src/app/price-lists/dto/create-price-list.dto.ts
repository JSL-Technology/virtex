
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsDateString, IsArray, ValidateNested, IsNumber, Min, IsUUID, IsEnum, IsOptional } from 'class-validator';
import { PriceListStatus } from '../entities/price-list.entity';

class CreatePriceListItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  price: number;
}

export class CreatePriceListDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  // Strings, for the same reason as `CreateVendorBillDto`: `enableImplicitConversion` turns a
  // `Date`-typed property into a `Date` before validation, and `@IsDateString()` refuses anything
  // that is not a string, so the request could never be accepted.
  @IsDateString()
  @IsNotEmpty()
  validFrom: string;

  @IsDateString()
  @IsNotEmpty()
  validTo: string;
  
  @IsEnum(PriceListStatus)
  @IsOptional()
  status?: PriceListStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceListItemDto)
  items: CreatePriceListItemDto[];
}