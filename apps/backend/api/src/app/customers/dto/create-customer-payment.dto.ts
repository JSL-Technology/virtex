import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

class CustomerPaymentLineDto {
  @IsUUID()
  @IsNotEmpty()
  invoiceId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class CreateCustomerPaymentDto {
  @IsUUID()
  @IsNotEmpty()
  customerId: string;

  @IsDateString()
  @IsNotEmpty()
  paymentDate: string;

  @IsUUID()
  @IsNotEmpty()
  bankAccountId: string;

  @IsString()
  @IsNotEmpty()
  reference: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerPaymentLineDto)
  lines: CustomerPaymentLineDto[];
}