import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { LandedCostAllocationMethod } from '../entities/landed-cost.entity';

export class CreateLandedCostDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(LandedCostAllocationMethod)
  @IsOptional()
  allocationMethod?: LandedCostAllocationMethod;

  @IsUUID()
  @IsOptional()
  glAccountId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
