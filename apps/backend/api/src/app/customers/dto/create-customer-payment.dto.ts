import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../entities/customer-payment.entity';

export class CustomerPaymentLineDto {
  @IsUUID()
  @IsNotEmpty()
  invoiceId: string;

  /** Cash applied to this invoice, in the receipt's currency. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  /**
   * Consumption tax the customer withheld and paid to the authority on our behalf.
   *
   * It settles the receivable without cash arriving, and is recoverable against our own return.
   * There was no field for it, so a receipt net of withholding under-relieved the invoice and left
   * the balance permanently short by the withheld amount.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  taxWithheld?: number;

  /** Income tax the customer withheld on this collection. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  incomeTaxWithheld?: number;

  /** Settlement discount granted on this invoice. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount?: number;
}

export class CreateCustomerPaymentDto {
  @IsUUID()
  @IsNotEmpty()
  customerId: string;

  @IsDateString()
  @IsNotEmpty()
  paymentDate: string;

  /** The bank or cash account the funds arrive in. */
  @IsUUID()
  @IsNotEmpty()
  bankAccountId: string;

  /**
   * Everything received, in `currencyCode`.
   *
   * Held separately from the sum of the lines so an advance or an overpayment can be recorded: the
   * difference is carried as unapplied cash. Previously the receipt had to match existing invoices
   * exactly, so a customer paying ahead had nowhere to be recorded.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amountReceived: number;

  @IsString()
  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  reference?: string;

  /** Which invoices this settles. May be empty for a pure advance. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerPaymentLineDto)
  @IsOptional()
  lines?: CustomerPaymentLineDto[];
}

export class VoidCustomerPaymentDto {
  /** Why: a bounced cheque, a returned transfer, a receipt raised in error. */
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  /** When the reversal is booked. Defaults to today. */
  @IsDateString()
  @IsOptional()
  reversalDate?: string;
}
