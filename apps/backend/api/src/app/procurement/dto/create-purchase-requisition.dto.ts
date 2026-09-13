import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchaseRequisitionLineDto {
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":500}' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  quantity: number;

  /** What the requester expects it to cost. An estimate: nobody has quoted yet. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'VALIDATION.CONSTRAINTS.MIN|{"min":0}' })
  @IsOptional()
  estimatedUnitPrice?: number;

  @IsString()
  @IsOptional()
  @MaxLength(16, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":16}' })
  unitOfMeasure?: string;
}

/**
 * `number`, `status` and `totalAmount` are deliberately absent.
 *
 * The number is allocated by the server, as a consecutive series per tenant and year — a client
 * that chooses its own document numbers produces duplicates and gaps the moment two people create
 * one at the same time. The status is a lifecycle the endpoints move, not a field to be set. And
 * the total is the sum of the lines: a total a caller can set independently of what it is buying
 * is a number an approver signs that means nothing.
 */
export class CreatePurchaseRequisitionDto {
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
  lines: PurchaseRequisitionLineDto[];
}
