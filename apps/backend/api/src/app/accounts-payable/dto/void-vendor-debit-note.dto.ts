import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Voiding a posted debit note: why, and on which date the reversal is booked. */
export class VoidVendorDebitNoteDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;

  /** The reversal's booking date (YYYY-MM-DD). Today when omitted; see `VoidVendorBillDto`. */
  @IsDateString()
  @IsOptional()
  reversalDate?: string;
}
