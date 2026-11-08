import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** One per-employee, per-concept variable input for a run. */
export class PayrollInputItemDto {
  @IsUUID()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  conceptCode: string;

  /**
   * For FIXED concepts. Never negative (audit 2026-11-07, NOM-03): a deduction of −20,000 raised
   * the net by 20,000 that no tax and no contribution ever saw. Money paid to the employee is an
   * EARNING concept, which is taxed and contributed on as its concept says.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(999_999_999_999.99, { message: 'validation.constraints.max|{"max":999999999999.99}' })
  @IsOptional()
  amount?: number;

  /** For HOURLY concepts — hours, of a month that has at most 744. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(744, { message: 'validation.constraints.max|{"max":744}' })
  @IsOptional()
  quantity?: number;

  /**
   * Overrides the concept's own rate/premium when set, within the same ceiling the concept has
   * (NOM-05): a fraction for a PERCENTAGE, a multiplier of at most 10 for an HOURLY. Checked
   * against the concept by `PayrollInputService`; here only the outer bound.
   */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(10, { message: 'payroll.concept_multiplier_too_high' })
  @IsOptional()
  rate?: number;

  @IsString()
  @IsOptional()
  note?: string;
}

/** A bulk replace of a run's inputs — the whole set is submitted before calculating. */
export class UpsertInputsDto {
  @IsArray()
  @ArrayMaxSize(50000, { message: 'validation.constraints.array_max_size|{"max":50000}' })
  @ValidateNested({ each: true })
  @Type(() => PayrollInputItemDto)
  items: PayrollInputItemDto[];
}
