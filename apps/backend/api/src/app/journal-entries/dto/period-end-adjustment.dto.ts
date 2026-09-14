
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CreateJournalEntryLineDto } from './create-journal-entry.dto';

export enum AdjustmentType {
  ACCRUAL = 'ACCRUAL',
  DEFERRAL = 'DEFERRAL',
  PROVISION = 'PROVISION',
  GENERAL = 'GENERAL',
}

export class CreatePeriodEndAdjustmentDto {
  @IsUUID()
  @IsNotEmpty({
    message: 'validation.period_end_adjustment.ledger_id_ledger_id_required',
  })
  ledgerId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsEnum(AdjustmentType)
  @IsNotEmpty()
  adjustmentType: AdjustmentType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];

  @IsUUID()
  @IsNotEmpty()
  journalId: string;

  @IsBoolean()
  @IsOptional()
  reversesNextPeriod?: boolean;
}
