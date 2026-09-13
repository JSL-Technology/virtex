import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PurchaseRequisitionLineDto } from './create-purchase-requisition.dto';

export class UpdatePurchaseRequisitionDto {
  @IsDateString()
  @IsOptional()
  requiredDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":2000}' })
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'VALIDATION.CONSTRAINTS.ARRAY_MIN_SIZE|{"min":1}' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequisitionLineDto)
  @IsOptional()
  lines?: PurchaseRequisitionLineDto[];
}
