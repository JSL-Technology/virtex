import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** How far back a trend looks, and how many slices a breakdown keeps. */
export class ChartWindowDto {
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(60, { message: 'validation.constraints.max|{"max":60}' })
  @IsOptional()
  months?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(50, { message: 'validation.constraints.max|{"max":50}' })
  @IsOptional()
  limit?: number;
}
