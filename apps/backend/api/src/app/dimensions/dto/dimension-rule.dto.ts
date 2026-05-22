
import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateDimensionRuleDto {
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsUUID()
  @IsNotEmpty()
  dimensionId: string;
}