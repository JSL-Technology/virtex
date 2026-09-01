import {
  IsUUID,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  IsNumber,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ModificationCode } from '../entities/invoice.entity';

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
  @MaxLength(500)
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
   * DGII `CodigoModificacion`. Absent, it is derived: a full credit annuls (1), a partial credit
   * corrects amounts (3). The previous code always transmitted 3, including when annulling.
   */
  @IsEnum(ModificationCode)
  @IsOptional()
  modificationCode?: ModificationCode;

  /**
   * Whether the returned goods re-enter inventory. False for a price adjustment, a discount granted
   * after the fact, or goods returned damaged — cases where crediting the customer must not create
   * stock that does not exist.
   */
  @IsOptional()
  restockGoods?: boolean;
}
