import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { CostCenterType } from '../entities/cost-center.entity';

export class CreateCostCenterDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(CostCenterType)
  type: CostCenterType;
}
