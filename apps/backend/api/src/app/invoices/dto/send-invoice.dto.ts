import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { BlankToUndefined } from '../../common/transformers/blank-to-undefined.transformer';

/** Where to send an invoice, and an optional note for the body. */
export class SendInvoiceDto {
  /** Defaults to the customer's e-mail on file. */
  @BlankToUndefined()
  @IsEmail()
  @IsOptional()
  to?: string;

  @BlankToUndefined()
  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'validation.constraints.max_length|{"max":1000}' })
  message?: string;
}
