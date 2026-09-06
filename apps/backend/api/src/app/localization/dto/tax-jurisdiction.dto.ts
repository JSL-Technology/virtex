import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  JurisdictionLevel,
  SourcingRule,
} from '../fiscal/entities/tax-jurisdiction.entity';

/**
 * A rate the tenant is registered to collect, in one jurisdiction, over one period.
 *
 * Every field is stated rather than derived: which state, which level, what rate, from when, and
 * whether the tenant is actually registered there. Post-*Wayfair* economic nexus depends on the
 * tenant's own sales volume into a state, which this product does not decide for them.
 */
export class CreateTaxJurisdictionDto {
  @IsString()
  @Length(2, 2, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":2,"max":2}' })
  countryCode: string;

  /** `TX`, `CA`, `SP`. Required: no rate in these markets is nationwide. */
  @IsString()
  @Length(1, 8)
  stateCode: string;

  @IsString()
  @IsOptional()
  @Length(1, 120)
  county?: string;

  @IsString()
  @IsOptional()
  @Length(1, 120)
  city?: string;

  /** Narrows a row; never defines one. One postal code can straddle two cities. */
  @IsString()
  @IsOptional()
  @Length(1, 16)
  postalCode?: string;

  @IsEnum(JurisdictionLevel)
  level: JurisdictionLevel;

  @IsString()
  @Length(1, 160)
  name: string;

  /** As a fraction: `0.0825` is 8.25 %. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @Max(1, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":1}' })
  rate: number;

  @IsBoolean()
  @IsOptional()
  isRegistered?: boolean;

  /** Which address prices an intrastate sale. Meaningful on a state-level row. */
  @IsEnum(SourcingRule)
  @IsOptional()
  sourcing?: SourcingRule;

  @IsDateString()
  effectiveFrom: string;

  /** Null while current. A superseded rate keeps its own window so old documents stay priceable. */
  @IsDateString()
  @IsOptional()
  effectiveTo?: string | null;
}

export class UpdateTaxJurisdictionDto extends PartialType(CreateTaxJurisdictionDto) {}
