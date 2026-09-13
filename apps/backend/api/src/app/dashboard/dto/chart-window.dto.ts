import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** How far back a trend looks, and how many slices a breakdown keeps. */
export class ChartWindowDto {
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @Max(60, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":60}' })
  @IsOptional()
  months?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @Max(50, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":50}' })
  @IsOptional()
  limit?: number;
}
