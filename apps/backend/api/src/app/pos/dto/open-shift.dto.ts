import { IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

export class OpenShiftDto {
  @IsString()
  @MaxLength(120)
  terminalId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  openingBalance: number;
}
