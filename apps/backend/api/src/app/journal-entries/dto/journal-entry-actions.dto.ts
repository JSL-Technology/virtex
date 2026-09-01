import { IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { CreateJournalEntryDto } from './create-journal-entry.dto';

export class UpdateJournalEntryDto extends CreateJournalEntryDto {
  @IsString()
  @IsNotEmpty({ message: 'VALIDATION.JOURNAL_ENTRY_ACTIONS.REQUIERE_RAZON_PARA_MODIFICACION' })
  modificationReason: string;
}

export class ReverseJournalEntryDto {
  @IsDateString({}, { message: 'VALIDATION.JOURNAL_ENTRY_ACTIONS.FECHA_REVERSION_DEBE_FECHA_VALIDA'})
  @IsNotEmpty({ message: 'VALIDATION.JOURNAL_ENTRY_ACTIONS.FECHA_REVERSION_OBLIGATORIA'})
  reversalDate: string;

  @IsString()
  @IsNotEmpty({ message: 'VALIDATION.JOURNAL_ENTRY_ACTIONS.REQUIERE_RAZON_PARA_REVERSION' })
  reason: string;
}
