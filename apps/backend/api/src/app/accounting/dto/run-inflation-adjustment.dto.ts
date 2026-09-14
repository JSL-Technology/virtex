
import { IsInt, IsNotEmpty, Max, Min } from 'class-validator';

export class RunInflationAdjustmentDto {
  @IsInt()
  @IsNotEmpty()
  year: number;

  @IsInt()
  @IsNotEmpty()
  @Min(1, { message: 'validation.constraints.min|{"min":1}' })
  @Max(12, { message: 'validation.constraints.max|{"max":12}' })
  month: number;
}
