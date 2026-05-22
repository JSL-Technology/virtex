
import { IsDateString, IsNotEmpty, IsNumber, IsString, IsUUID, Min } from 'class-validator';

export class CreateIntercompanyTransactionDto {
  @IsUUID()
  @IsNotEmpty()
  toOrganizationId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsUUID()
  @IsNotEmpty()
  fromAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  toAccountId: string;
}