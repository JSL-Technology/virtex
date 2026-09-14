import { IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { CreateJournalEntryDto } from './create-journal-entry.dto';

export class UpdateJournalEntryDto extends CreateJournalEntryDto {
  @IsString()
  @IsNotEmpty({ message: 'validation.journal_entry_actions.reason_change_required' })
  modificationReason: string;
}

export class ReverseJournalEntryDto {
  @IsDateString({}, { message: 'validation.journal_entry_actions.reversal_date_must_valid_date'})
  @IsNotEmpty({ message: 'validation.journal_entry_actions.reversal_date_required'})
  reversalDate: string;

  @IsString()
  @IsNotEmpty({ message: 'validation.journal_entry_actions.reason_reversal_required' })
  reason: string;
}
