import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { LeaveKind } from '../entities/employee-leave.entity';

export class RequestLeaveDto {
  @IsEnum(LeaveKind, { message: 'validation.constraints.is_enum' })
  kind: LeaveKind;

  @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  startDate: string;

  @IsISO8601({ strict: true }, { message: 'validation.constraints.is_date_string' })
  endDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason?: string;
}

export class DecideLeaveDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  note?: string;
}
