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
  Min,
  ValidateNested,
} from 'class-validator';

export class VendorBillPaymentLineDto {
  @IsUUID()
  @IsNotEmpty()
  vendorBillId: string;

  /**
   * How much of this bill to settle, in the bill's own currency.
   *
   * The previous implementation had no such field: `createPaymentBatch` paid `bill.balance` for
   * every selected bill and marked it PAID unconditionally. There was no partial payment, no early
   * settlement discount, and no way to withhold — all three are routine, and withholding is
   * mandatory across most of the region.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  /** Tax withheld from the supplier on this payment and owed to the authority. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  taxWithheld?: number;

  /** Income tax withheld from the supplier on this payment. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  incomeTaxWithheld?: number;

  /** Early-payment discount taken. Reduces the bill's balance without cash leaving. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount?: number;
}

export class PayVendorBillsDto {
  @IsDateString()
  @IsNotEmpty()
  paymentDate: string;

  /** The bank or cash account the funds leave. */
  @IsUUID()
  @IsNotEmpty()
  bankAccountId: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VendorBillPaymentLineDto)
  lines: VendorBillPaymentLineDto[];
}
