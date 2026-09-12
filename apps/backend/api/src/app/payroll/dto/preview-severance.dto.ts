import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class PreviewSeveranceDto {
  /** Last day worked. */
  @IsDateString()
  endDate: string;

  /** Override the monthly salary; defaults to the employee's compensation in force at `endDate`. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  monthlySalary?: number;

  /** Actual ordinary salary earned in the calendar year, for an exact regalía. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  ordinarySalaryEarnedThisYear?: number;
}
