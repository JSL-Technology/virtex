
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsDateString, IsArray, ValidateNested, IsNumber, Min, IsUUID, IsEnum, IsOptional } from 'class-validator';
import { PriceListStatus } from '../entities/price-list.entity';

class CreatePriceListItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @Min(0)
  price: number;
}

export class CreatePriceListDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsDateString()
  @IsNotEmpty()
  validFrom: Date;

  @IsDateString()
  @IsNotEmpty()
  validTo: Date;
  
  @IsEnum(PriceListStatus)
  @IsOptional()
  status?: PriceListStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceListItemDto)
  items: CreatePriceListItemDto[];
}