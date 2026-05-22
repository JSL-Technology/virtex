
import { IsString, IsNotEmpty, IsDateString, IsNumberString, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class UploadStatementDto {
  @IsString()
  @IsNotEmpty({ message: 'El ID de la cuenta no puede estar vacío.' })
  accountId: string;

  @IsDateString({}, { message: 'La fecha de inicio debe ser una fecha válida.' })
  @IsNotEmpty({ message: 'La fecha de inicio no puede estar vacía.' })
  startDate: string;

  @IsDateString({}, { message: 'La fecha de fin debe ser una fecha válida.' })
  @IsNotEmpty({ message: 'La fecha de fin no puede estar vacía.' })
  endDate: string;

  @IsNumberString({}, { message: 'El saldo inicial debe ser un número.' })
  @IsNotEmpty({ message: 'El saldo inicial no puede estar vacío.' })
  @Transform(({ value }) => parseFloat(value))
  startingBalance: number;

  @IsNumberString({}, { message: 'El saldo final debe ser un número.' })
  @IsNotEmpty({ message: 'El saldo final no puede estar vacío.' })
  @Transform(({ value }) => parseFloat(value))
  endingBalance: number;


  @IsString()
  @IsNotEmpty()
  dateColumn: string;

  @IsString()
  @IsNotEmpty()
  descriptionColumn: string;

  @IsString()
  @IsOptional()
  debitColumn?: string;

  @IsString()
  @IsOptional()
  creditColumn?: string;
  
  @IsString()
  @IsOptional()
  amountColumn?: string;
}