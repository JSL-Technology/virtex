import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { VendorDebitNoteStatus } from '../entities/vendor-debit-note.entity';

export class VendorDebitNoteQueryDto {
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsUUID()
  @IsOptional()
  vendorBillId?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsIn(Object.values(VendorDebitNoteStatus))
  @IsOptional()
  status?: VendorDebitNoteStatus;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}
