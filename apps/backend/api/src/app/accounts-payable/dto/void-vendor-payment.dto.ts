import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Voiding a payment to suppliers: why — a returned cheque, a rejected transfer, an error — and when. */
export class VoidVendorPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;

  /** The reversal's booking date (YYYY-MM-DD). Today, in the company's zone, when omitted. */
  @IsDateString()
  @IsOptional()
  reversalDate?: string;
}
