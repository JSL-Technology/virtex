
import { IsInt, IsNotEmpty, Max, Min } from 'class-validator';

export class RunInflationAdjustmentDto {
  @IsInt()
  @IsNotEmpty()
  year: number;

  @IsInt()
  @IsNotEmpty()
  @Min(1)
  @Max(12)
  month: number;
}
