import {
  IsUUID,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  IsNumber,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OmitType } from '@nestjs/mapped-types';
import { CREDIT_NOTE_REASONS, type CreditNoteReason } from '../../markets';

export class CreditNoteLineItemDto {
  /** The invoice LINE being credited. Identifying by product could not distinguish two lines of
   *  the same item at different prices, and made partial credits ambiguous. */
  @IsUUID()
  lineId: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  quantity: number;
}

export class CreateCreditNoteDto {
  @IsUUID()
  invoiceId: string;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason?: string;

  /**
   * Lines and quantities to credit. Absent, the whole remaining balance of the invoice is credited
   * and the invoice is annulled.
   */
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineItemDto)
  items?: CreditNoteLineItemDto[];

  /**
   * Why the note is issued, in the product's own terms; each market writes its authority's code for
   * it. Absent, it is derived from what is credited: the whole document annuls it, a part of it is
   * recorded as `OTHER` with the words the issuer wrote in `reason`.
   *
   * This was the DGII's `CodigoModificacion` — one market's catalogue, accepted from every market's
   * tenant and stored on every invoice.
   */
  @IsIn(CREDIT_NOTE_REASONS)
  @IsOptional()
  adjustmentReason?: CreditNoteReason;

  /**
   * Whether the returned goods re-enter inventory. False for a price adjustment, a discount granted
   * after the fact, or goods returned damaged — cases where crediting the customer must not create
   * stock that does not exist.
   */
  @IsOptional()
  restockGoods?: boolean;
}

/**
 * The body of `POST /invoices/:id/credit-note`. The invoice comes from the route, so the body must
 * not be required to repeat it: it was, and every credit note and annulment from the UI failed
 * validation with «invoice es obligatorio» before reaching the service (QA R3-C01).
 */
export class CreditNoteBodyDto extends OmitType(CreateCreditNoteDto, ['invoiceId'] as const) {}
