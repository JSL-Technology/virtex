
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateReclassificationEntryDto {
  @IsUUID()
  @IsNotEmpty({
    message: 'El ID del libro contable (ledgerId) es obligatorio.',
  })
  ledgerId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsUUID()
  @IsNotEmpty()
  fromAccountId: string;

  @IsUUID()
  @IsNotEmpty()
  toAccountId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsUUID()
  @IsNotEmpty()
  journalId: string;
}
