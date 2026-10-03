import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  /**
   * Why stock or unit cost changed. Required when either does (QA M-08): changing them posts an
   * inventory adjustment, and an adjustment nobody can explain is the one an auditor asks about.
   * Recorded on the entry and on the stock-ledger line.
   */
  @IsString()
  @IsOptional()
  @MinLength(5, { message: 'validation.constraints.min_length|{"min":5}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  adjustmentReason?: string;
}
