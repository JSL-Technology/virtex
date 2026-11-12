import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * A note that reduces what a supplier is owed on one bill: goods returned, a price corrected, a
 * rebate agreed. Posted on creation — Dr Payables / Cr the account the bill charged (and Cr input
 * tax for the tax portion) — and corrected only by voiding it.
 */
export class CreateVendorDebitNoteDto {
  @IsUUID()
  @IsNotEmpty()
  vendorBillId: string;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;

  /** In the bill's currency, tax included. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  /** The part of `amount` that is input tax being given back. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  taxAmount?: number;

  /** The account the bill charged for what is being returned or corrected. */
  @IsUUID()
  @IsNotEmpty()
  expenseAccountId: string;

  /** The day it takes effect (YYYY-MM-DD). Today when omitted. */
  @IsDateString()
  @IsOptional()
  date?: string;

  /**
   * The number on the supplier's own document for it — the credit note they issued — checked by the
   * market's rule in the service. The border used to demand 11 to 19 letters and digits, the shape
   * of a Dominican comprobante, from a tenant of any market.
   */
  @Transform(trim)
  @IsString()
  @MaxLength(40, { message: 'validation.constraints.max_length|{"max":40}' })
  @IsOptional()
  supplierFiscalNumber?: string;
}
