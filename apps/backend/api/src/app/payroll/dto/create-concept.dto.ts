import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ConceptCalculation, ConceptType } from '../entities/payroll-concept.entity';

export class CreateConceptDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ConceptType)
  type: ConceptType;

  @IsEnum(ConceptCalculation)
  @IsOptional()
  calculation?: ConceptCalculation;

  /** PERCENTAGE fraction (0.03) or HOURLY premium multiplier (1.35). */
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsOptional()
  rate?: number;

  @IsBoolean()
  @IsOptional()
  taxable?: boolean;

  @IsBoolean()
  @IsOptional()
  contributesToTss?: boolean;

  @IsUUID()
  @IsOptional()
  accountId?: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
