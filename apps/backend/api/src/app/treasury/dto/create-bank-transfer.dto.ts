import { IsDateString, IsNotEmpty, IsNumber, IsString, IsUUID, Min } from 'class-validator';

export class CreateBankTransferDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsUUID()
  @IsNotEmpty()
  fromAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  toAccountId: string;
  
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  reference: string;
}