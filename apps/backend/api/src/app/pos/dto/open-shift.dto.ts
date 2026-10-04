import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class OpenShiftDto {
  @IsString()
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  terminalId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1_000_000_000)
  openingBalance: number;

  /**
   * The branch the till stands in. Omitted: the cashier's default branch, else the headquarters.
   * Every sale rung on the shift is a sale of this branch.
   */
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
