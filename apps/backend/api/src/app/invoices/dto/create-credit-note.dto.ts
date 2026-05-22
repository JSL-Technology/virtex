
import { IsUUID, IsOptional, IsString, IsArray, ValidateNested, Min, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreditNoteLineItemDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CreateCreditNoteDto {
  @IsUUID()
  invoiceId: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineItemDto)
  items?: CreditNoteLineItemDto[];
}
