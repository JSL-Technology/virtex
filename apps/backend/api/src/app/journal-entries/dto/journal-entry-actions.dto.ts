import { IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { CreateJournalEntryDto } from './create-journal-entry.dto';

export class UpdateJournalEntryDto extends CreateJournalEntryDto {
  @IsString()
  @IsNotEmpty({ message: 'Se requiere una razón para la modificación.' })
  modificationReason: string;
}

export class ReverseJournalEntryDto {
  @IsDateString({}, { message: 'La fecha de reversión debe ser una fecha válida.'})
  @IsNotEmpty({ message: 'La fecha de reversión es obligatoria.'})
  reversalDate: string;

  @IsString()
  @IsNotEmpty({ message: 'Se requiere una razón para la reversión.' })
  reason: string;
}
