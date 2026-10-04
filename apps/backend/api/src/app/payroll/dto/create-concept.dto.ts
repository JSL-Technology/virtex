import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ConceptCalculation, ConceptType } from '../entities/payroll-concept.entity';

/**
 * A rate that means something for its calculation (QA M-04: a «Tasa» of 5000 overflowed the
 * column and came back as a 500). A PERCENTAGE is a fraction — 0.03 is 3 %, so at most 1. An HOURLY
 * premium is a multiplier of the hourly wage — 1.35 for overtime, 2.0 for holidays — and nothing
 * in any labour code in this product's markets reaches 10.
 */
@ValidatorConstraint({ name: 'concept_rate', async: false })
export class ConceptRateConstraint implements ValidatorConstraintInterface {
  private static readonly LIMIT: Partial<Record<ConceptCalculation, number>> = {
    [ConceptCalculation.PERCENTAGE]: 1,
    [ConceptCalculation.HOURLY]: 10,
  };

  validate(rate: unknown, args: ValidationArguments): boolean {
    if (typeof rate !== 'number') return true;
    const calculation = (args.object as { calculation?: ConceptCalculation }).calculation;
    const limit = calculation ? ConceptRateConstraint.LIMIT[calculation] : undefined;
    return limit === undefined || rate <= limit;
  }

  defaultMessage(args: ValidationArguments): string {
    const calculation = (args.object as { calculation?: ConceptCalculation }).calculation;
    return calculation === ConceptCalculation.PERCENTAGE
      ? 'payroll.concept_rate_is_a_fraction'
      : 'payroll.concept_multiplier_too_high';
  }
}

export class CreateConceptDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ConceptType)
  type: ConceptType;

  @IsEnum(ConceptCalculation)
  @IsOptional()
  calculation?: ConceptCalculation;

  /** PERCENTAGE fraction (0.03) or HOURLY premium multiplier (1.35). */
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Validate(ConceptRateConstraint)
  rate?: number;

  @IsBoolean()
  @IsOptional()
  taxable?: boolean;

  @IsBoolean()
  @IsOptional()
  contributesToTss?: boolean;

  @IsUUID()
  @IsOptional()
  accountId?: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
