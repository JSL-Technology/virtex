
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProposedAdjustmentLineDto {
  @IsUUID('4', { message: 'validation.proposed_adjustment.account_id_must_valid_uuid' })
  @IsNotEmpty({ message: 'validation.proposed_adjustment.account_id_required_every_line' })
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.proposed_adjustment.debit_must_valid_number' })
  @IsDefined({ message: 'validation.proposed_adjustment.debit_field_required' })
  @Min(0, { message: 'validation.proposed_adjustment.debit_cannot_negative' })
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'validation.proposed_adjustment.credit_must_valid_number' })
  @IsDefined({ message: 'validation.proposed_adjustment.credit_field_required' })
  @Min(0, { message: 'validation.proposed_adjustment.credit_cannot_negative' })
  credit: number;

  @IsString()
  @IsNotEmpty({ message: 'validation.proposed_adjustment.line_description_cannot_empty' })
  description: string;

  @IsObject()
  @IsOptional()
  dimensions?: Record<string, string>;
}

export class CreateProposedAdjustmentDto {
  @IsUUID('4', { message: 'validation.proposed_adjustment.fiscal_year_id_must_valid_uuid' })
  @IsNotEmpty({ message: 'validation.proposed_adjustment.fiscal_year_id_required' })
  fiscalYearId: string;

  @IsDateString({}, { message: 'validation.proposed_adjustment.date_must_valid_iso_8601_format' })
  @IsNotEmpty({ message: 'validation.proposed_adjustment.adjustment_date_required' })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'validation.proposed_adjustment.adjustment_main_description_cannot_empty' })
  description: string;

  @IsUUID('4', { message: 'validation.proposed_adjustment.journal_id_must_valid_uuid' })
  @IsNotEmpty({ message: 'validation.proposed_adjustment.journal_id_required' })
  journalId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposedAdjustmentLineDto)
  lines: ProposedAdjustmentLineDto[];
}