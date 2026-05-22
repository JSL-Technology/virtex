import { IsNotEmpty, IsNumber, IsString, IsUUID, Min } from 'class-validator';

export class CreateVendorDebitNoteDto {
  @IsUUID()
  @IsNotEmpty()
  vendorBillId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsNumber()
  @Min(0.01)
  amount: number;


  @IsUUID()
  @IsNotEmpty()
  expenseAccountId: string;
}