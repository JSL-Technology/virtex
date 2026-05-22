
import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { ModuleSlug } from '../entities/accounting-period.entity';

export class ModulePeriodDto {
  @IsUUID()
  @IsNotEmpty()
  periodId: string;

  @IsEnum(ModuleSlug)
  @IsNotEmpty()
  module: ModuleSlug;
}