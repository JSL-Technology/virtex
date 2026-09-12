import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, Length } from 'class-validator';
import { PayFrequency } from '../entities/employee-compensation.entity';

export class CreateCompensationDto {
  @IsDateString()
  effectiveFrom: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  baseSalary: number;

  @IsEnum(PayFrequency)
  @IsOptional()
  payFrequency?: PayFrequency;

  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;
}
