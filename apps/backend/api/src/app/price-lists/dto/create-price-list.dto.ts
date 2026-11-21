import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsUUID,
  IsEnum,
  IsOptional,
  IsBoolean,
  Matches,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { PriceListStatus } from '../entities/price-list.entity';

class CreatePriceListItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  price: number;

  /** The quantity from which this price applies; 1 when omitted. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'validation.constraints.min|{"min":0.0001}' })
  minQuantity?: number;
}

export class CreatePriceListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  /** ISO 4217: a list is in one currency and is never converted. */
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'validation.currency_code' })
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

  /** The list for every customer without one, in this currency. Clears the flag on the others. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsArray()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => CreatePriceListItemDto)
  items: CreatePriceListItemDto[];
}
