import { IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

export class OpenShiftDto {
  @IsString()
  @MaxLength(120, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":120}' })
  terminalId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @Max(1_000_000_000)
  openingBalance: number;
}
