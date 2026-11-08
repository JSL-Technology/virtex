import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { TaxType } from '../entities/tax.entity';

/**
 * A percentage rate is at most 100 (QA M-04: a 150 % tax was accepted, and every invoice line
 * using it would have charged more tax than the price). A FIXED tax is an amount and has no cap.
 */
@ValidatorConstraint({ name: 'percentage_rate', async: false })
export class PercentageRateConstraint implements ValidatorConstraintInterface {
  validate(rate: unknown, args: ValidationArguments): boolean {
    const type = (args.object as { type?: TaxType }).type ?? TaxType.PERCENTAGE;
    return type !== TaxType.PERCENTAGE || typeof rate !== 'number' || rate <= 100;
  }

  defaultMessage(): string {
    return 'validation.constraints.max|{"max":100}';
  }
}

@ValidatorConstraint({ name: 'period_end', async: false })
export class PeriodEndConstraint implements ValidatorConstraintInterface {
  validate(end: unknown, args: ValidationArguments): boolean {
    const start = (args.object as { effectiveFrom?: string }).effectiveFrom;
    return typeof end !== 'string' || !start || end >= start;
  }

  defaultMessage(): string {
    return 'taxes.effective_to_before_effective_from';
  }
}

export class CreateTaxDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  name: string;

  @IsNumber()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Validate(PercentageRateConstraint)
  rate: number;

  @IsEnum(TaxType)
  @IsOptional()
  type?: TaxType;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/, { message: 'validation.constraints.country_code' })
  countryCode?: string;

  /** First day the rate may be applied (LOC-06). Omitted: no lower bound. */
  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;

  /** Last day the rate may be applied; a rate that ends is closed here, never edited. */
  @IsOptional()
  @IsDateString({ strict: true })
  @Validate(PeriodEndConstraint)
  effectiveTo?: string;
}
