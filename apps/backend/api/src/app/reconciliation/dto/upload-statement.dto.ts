
import { IsString, IsNotEmpty, IsDateString, IsNumberString, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class UploadStatementDto {
  @IsString()
  @IsNotEmpty({ message: 'VALIDATION.UPLOAD_STATEMENT.ID_CUENTA_NO_PUEDE_ESTAR_VACIO' })
  accountId: string;

  @IsDateString({}, { message: 'VALIDATION.UPLOAD_STATEMENT.FECHA_INICIO_DEBE_FECHA_VALIDA' })
  @IsNotEmpty({ message: 'VALIDATION.UPLOAD_STATEMENT.FECHA_INICIO_NO_PUEDE_ESTAR_VACIA' })
  startDate: string;

  @IsDateString({}, { message: 'VALIDATION.UPLOAD_STATEMENT.FECHA_FIN_DEBE_FECHA_VALIDA' })
  @IsNotEmpty({ message: 'VALIDATION.UPLOAD_STATEMENT.FECHA_FIN_NO_PUEDE_ESTAR_VACIA' })
  endDate: string;

  @IsNumberString({}, { message: 'VALIDATION.UPLOAD_STATEMENT.SALDO_INICIAL_DEBE_NUMERO' })
  @IsNotEmpty({ message: 'VALIDATION.UPLOAD_STATEMENT.SALDO_INICIAL_NO_PUEDE_ESTAR_VACIO' })
  @Transform(({ value }) => parseFloat(value))
  startingBalance: number;

  @IsNumberString({}, { message: 'VALIDATION.UPLOAD_STATEMENT.SALDO_FINAL_DEBE_NUMERO' })
  @IsNotEmpty({ message: 'VALIDATION.UPLOAD_STATEMENT.SALDO_FINAL_NO_PUEDE_ESTAR_VACIO' })
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