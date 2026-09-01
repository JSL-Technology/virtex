
import { IsInt, IsNotEmpty, Max, Min } from 'class-validator';

export class RunInflationAdjustmentDto {
  @IsInt()
  @IsNotEmpty()
  year: number;

  @IsInt()
  @IsNotEmpty()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @Max(12, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":12}' })
  month: number;
}
