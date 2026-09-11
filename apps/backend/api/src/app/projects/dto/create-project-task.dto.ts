import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateProjectTaskDto {
  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  @IsOptional()
  assignedToUserId?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsInt()
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @Max(100, { message: 'VALIDATION.CONSTRAINTS.MAX|{"max":100}' })
  @IsOptional()
  percentComplete?: number;
}
