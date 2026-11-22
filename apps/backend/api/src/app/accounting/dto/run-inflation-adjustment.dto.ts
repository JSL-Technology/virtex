import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ISO_MONTH_PATTERN } from '@virtex/shared/types';

/** Restate a ledger at the end of a month. */
export class RunInflationAdjustmentDto {
  /** `2026-03`: the month whose end the books are expressed in. */
  @Matches(ISO_MONTH_PATTERN, { message: 'validation.price_indices.period_format' })
  period: string;

  /** Omitted: the company's default ledger. */
  @IsOptional()
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  ledgerId?: string;

  /**
   * Replace the month's run when there is one: reverse it and book the current figure. Without it,
   * a month already restated answers with that run.
   */
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

export class InflationAdjustmentOutlookQueryDto {
  @Matches(ISO_MONTH_PATTERN, { message: 'validation.price_indices.period_format' })
  period: string;

  @IsOptional()
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  ledgerId?: string;
}

export class InflationAdjustmentRunsQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  ledgerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900, { message: 'validation.constraints.min|{"min":1900}' })
  @Max(2999, { message: 'validation.constraints.max|{"max":2999}' })
  year?: number;
}

export class ReverseInflationAdjustmentDto {
  @IsString()
  @IsNotEmpty({ message: 'validation.constraints.is_not_empty' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;
}
