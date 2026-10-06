import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaymentBatchStatus } from '../entities/payment-batch.entity';

export class VendorPaymentQueryDto {
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsUUID()
  @IsOptional()
  bankAccountId?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsIn(Object.values(PaymentBatchStatus))
  @IsOptional()
  status?: PaymentBatchStatus;

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
