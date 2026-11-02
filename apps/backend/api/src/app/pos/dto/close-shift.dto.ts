import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CloseShiftDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1_000_000_000)
  closingBalance: number;

  /** Why the count differs from what was expected. Required when it does. */
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  closingNotes?: string;
}
