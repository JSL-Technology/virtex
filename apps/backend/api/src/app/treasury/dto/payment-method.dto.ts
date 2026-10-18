import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import {
  PAYMENT_SETTLEMENT_KINDS,
  PaymentSettlementKind,
} from '../../contracts/country-pack/country-pack';

export class CreatePaymentMethodDto {
  /** What documents record. Letters, digits, `_` and `-`; stored upper case. */
  @IsString()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'treasury.payment_method_code_format' })
  code: string;

  @IsString()
  @MinLength(1, { message: 'validation.constraints.min_length|{"min":1}' })
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  name: string;

  @IsIn(PAYMENT_SETTLEMENT_KINDS as PaymentSettlementKind[])
  kind: PaymentSettlementKind;

  /** The authority's code for it, where the market has a catalogue (SAT `03`, DIAN `47`). */
  @IsString()
  @IsOptional()
  @MaxLength(10, { message: 'validation.constraints.max_length|{"max":10}' })
  fiscalCode?: string | null;

  @IsInt()
  @IsOptional()
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @Max(10000, { message: 'validation.constraints.max|{"max":10000}' })
  sortOrder?: number;
}

/** Everything but the code may change; the code is what past documents recorded. */
export class UpdatePaymentMethodDto extends PartialType(CreatePaymentMethodDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
