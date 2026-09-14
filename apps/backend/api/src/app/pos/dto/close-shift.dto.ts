import { IsNumber, Max, Min } from 'class-validator';

export class CloseShiftDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1_000_000_000)
  closingBalance: number;
}
