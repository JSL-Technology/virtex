
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsUUID, ValidateNested } from 'class-validator';


class MappingRuleItemDto {
  @IsUUID()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  parentAccountId: string;

  @IsNumber()
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