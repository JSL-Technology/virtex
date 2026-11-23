
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsUUID, ValidateNested } from 'class-validator';


class MappingRuleItemDto {
  @IsUUID()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  parentAccountId: string;

  /**
   * What the target ledger records per unit the source ledger does. Positive: a valuation is a debit
   * or a credit of zero or more, and a negative factor would turn every posting on the account into
   * one the ledger refuses.
   */
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  @IsOptional()
  multiplier?: number;
}


export class CreateOrUpdateLedgerMapDto {
  @IsUUID()
  @IsNotEmpty()
  sourceLedgerId: string;

  @IsUUID()
  @IsNotEmpty()
  targetLedgerId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingRuleItemDto)
  mappings: MappingRuleItemDto[];
}