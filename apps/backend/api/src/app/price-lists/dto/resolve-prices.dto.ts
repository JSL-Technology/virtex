import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsUUID, Matches, Min, ValidateNested } from 'class-validator';

class PriceQueryDto {
  @IsUUID()
  productId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  quantity: number;
}

/** `POST /price-lists/resolve`: the prices a document being composed will be charged at. */
export class ResolvePricesDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** The document's currency; the organization's base currency when omitted. */
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, { message: 'validation.currency_code' })
  currencyCode?: string;

  /** The document's issue date; today when omitted. */
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PriceQueryDto)
  lines: PriceQueryDto[];
}
