import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PurchaseRequisitionStatus } from '../entities/purchase-requisition.entity';

export class CreatePurchaseRequisitionDto {
  @IsString()
  @IsNotEmpty()
  number: string;

  @IsEnum(PurchaseRequisitionStatus)
  @IsOptional()
  status?: PurchaseRequisitionStatus;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @IsOptional()
  totalAmount?: number;

  @IsDateString()
  @IsOptional()
  requiredDate?: string;
}
