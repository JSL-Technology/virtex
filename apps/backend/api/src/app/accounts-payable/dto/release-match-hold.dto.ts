import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Why a bill the three-way match held is released (audit 2026-11-07, CMP-01). Required: paying for
 * goods not received, or at a price nobody agreed, is a decision the bill must carry.
 */
export class ReleaseMatchHoldDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'validation.constraints.min_length|{"min":5}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;
}
