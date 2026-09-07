import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { TaxpayerType } from '../fiscal/withholding-regimes';

/**
 * A withholding regime the tenant configures.
 *
 * `legalBasis` is required, and deliberately so: the point of moving withholding off the request
 * was to stop the rate being a number somebody typed, and a regime with no stated authority is a
 * number somebody typed with extra steps.
 */
export class CreateWithholdingRegimeDto {
  @IsString()
  @Length(1, 40)
  code: string;

  @IsString()
  @Length(1, 160)
  label: string;

  /** `VAT` withholds a share of the output tax; `INCOME` a share of the taxable base. */
  @IsIn(['VAT', 'INCOME'])
  kind: 'VAT' | 'INCOME';

  /** As a fraction: `0.30` is 30 %. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @Max(1, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":1}' })
  rate: number;

  /** Buyer classifications this applies to. Empty applies to nobody and is refused. */
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(TaxpayerType, { each: true })
  payers: TaxpayerType[];

  /** Seller classifications. Empty means it does not depend on the seller. */
  @IsArray()
  @IsEnum(TaxpayerType, { each: true })
  @IsOptional()
  payees?: TaxpayerType[];

  @IsIn(['SERVICES', 'GOODS', 'ANY'])
  @IsOptional()
  scope?: 'SERVICES' | 'GOODS' | 'ANY';

  /** The instrument that establishes it, so an advisor can confirm it in one lookup. */
  @IsString()
  @Length(3, 500)
  legalBasis: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateWithholdingRegimeDto extends PartialType(CreateWithholdingRegimeDto) {}
