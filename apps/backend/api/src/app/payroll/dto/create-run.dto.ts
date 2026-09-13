import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PayrollRunType } from '../entities/payroll-run.entity';

export class CreateRunDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  @Length(2, 2, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":2,"max":2}' })
  countryCode?: string;

  @IsInt()
  @Min(2000, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":2000}' })
  @Max(2100, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":2100}' })
  periodYear: number;

  @IsInt()
  @Min(1, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":1}' })
  @Max(12, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":12}' })
  periodMonth: number;

  @IsDateString()
  @IsOptional()
  payDate?: string;

  @IsEnum(PayrollRunType)
  @IsOptional()
  runType?: PayrollRunType;

  @IsUUID()
  @IsOptional()
  correctsRunId?: string;
}
