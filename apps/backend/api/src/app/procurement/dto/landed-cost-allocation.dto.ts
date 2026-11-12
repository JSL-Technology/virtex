import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/** Apply a landed cost to received goods (audit 2026-11-07, CMP-21). */
export class ApplyLandedCostDto {
  /** The catalogue entry: allocation method and the account the cost is credited to. */
  @IsUUID()
  landedCostId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  receiptIds: string[];

  /** In the books' currency. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'validation.constraints.min|{"min":0.01}' })
  amount: number;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  reference?: string;
}

export class VoidLandedCostDto {
  @IsString()
  @MinLength(5, { message: 'validation.constraints.min_length|{"min":5}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;
}
