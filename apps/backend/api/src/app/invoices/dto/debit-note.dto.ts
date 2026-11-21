import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DEBIT_NOTE_REASONS, type DebitNoteReason } from '../../markets';
import { TaxTreatment } from '../entities/invoice-line-item.entity';

/**
 * A charge a debit note adds. Its tax treatment and whether it is a service are stated, never
 * assumed: whether late-payment interest bears VAT differs from one market to the next, and so
 * does how a return splits goods from services. The screen proposes; the server never guesses.
 */
export class DebitNoteLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0}' })
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001, { message: 'validation.constraints.min|{"min":0}' })
  unitPrice: number;

  @IsIn(Object.values(TaxTreatment))
  taxTreatment: TaxTreatment;

  /** A fraction (0.18). Omitted on a taxed line: the tenant's standard rate. Checked by the engine. */
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(1, { message: 'validation.constraints.max|{"max":1}' })
  @IsOptional()
  taxRate?: number;

  @IsBoolean()
  isService: boolean;
}

/** `POST /invoices/:id/debit-note` (audit 2026-11-07, FAC-INV-05). */
export class DebitNoteBodyDto {
  /** Why, in the product's own terms; each market writes its authority's code for it. */
  @IsIn(DEBIT_NOTE_REASONS)
  reason: DebitNoteReason;

  /** What the customer reads on the document. */
  @IsString()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  description: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  @ArrayMaxSize(100, { message: 'validation.constraints.array_max_size|{"max":100}' })
  @ValidateNested({ each: true })
  @Type(() => DebitNoteLineDto)
  lines: DebitNoteLineDto[];
}

/** `POST /invoices/:id/cancel` (FAC-INV-05): cancel an issued invoice nothing has touched. */
export class CancelInvoiceBodyDto {
  /** In words, always: it is the record of why. */
  @IsString()
  @MinLength(3, { message: 'validation.constraints.min_length|{"min":3}' })
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason: string;

  /**
   * The authority's reason code, where its catalogue has one — `GET /invoices/:id/cancellation`
   * lists them for the invoice's market. Checked against that catalogue, and by the database.
   */
  @IsString()
  @IsOptional()
  @MaxLength(16, { message: 'validation.constraints.max_length|{"max":16}' })
  reasonCode?: string;
}
