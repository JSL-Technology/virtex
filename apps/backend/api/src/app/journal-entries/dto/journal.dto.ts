
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import type { JournalType } from '../entities/journal.entity';

export class CreateJournalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEnum(['SALES', 'PURCHASES', 'CASH', 'BANK', 'GENERAL'])
  @IsNotEmpty()
  type: JournalType;
}