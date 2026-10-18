import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { VendorBillStatus } from '../entities/vendor-bill.entity';

/**
 * One supplier bill as a row of a file: who it is from, which comprobante, when, and what it
 * cost. It becomes a one-line `CreateVendorBillDto` and goes through the same service as the form.
 *
 * The export writes a few more columns than an import needs — the supplier's name, the balance,
 * the status. They are accepted and ignored, so an exported file imports as it is: the supplier is
 * found by tax id, and a new bill always starts as a draft with its whole amount open.
 */
export class VendorBillImportRowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30, { message: 'validation.constraints.max_length|{"max":30}' })
  vendorTaxId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(30, { message: 'validation.constraints.max_length|{"max":30}' })
  ncf?: string;

  @IsDateString()
  date!: string;

  @IsDateString()
  dueDate!: string;

  @IsString()
  @IsOptional()
  @Length(3, 3, { message: 'validation.constraints.length|{"min":3,"max":3}' })
  currencyCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'validation.constraints.min|{"min":0.01}' })
  subtotal!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  taxAmount?: number;

  /** When the file states it, it must agree with subtotal + tax. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  total?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50, { message: 'validation.constraints.max_length|{"max":50}' })
  expenseAccountCode!: string;

  // ── Written by the export, ignored on import ───────────────────────────────────────────────
  @IsString()
  @IsOptional()
  vendorName?: string;

  @IsOptional()
  @IsNumber()
  balance?: number;

  @IsOptional()
  @IsEnum(VendorBillStatus)
  status?: VendorBillStatus;
}
