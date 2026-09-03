import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Multipart bodies arrive as strings; the numbers and booleans have to be recovered. */
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value === 'true' || value === '1' : value;

export class UploadStatementDto {
  /**
   * The bank account this statement belongs to.
   *
   * It used to be `accountId`, a chart-of-accounts id, so a statement belonged to a control account
   * rather than to an account at a bank — and four accounts posting to `1102 Bancos` produced four
   * statements nothing could tell apart.
   */
  @IsUUID()
  @IsNotEmpty()
  bankAccountId: string;

  @IsDateString({}, { message: 'VALIDATION.UPLOAD_STATEMENT.FECHA_INICIO_DEBE_FECHA_VALIDA' })
  @IsNotEmpty({ message: 'VALIDATION.UPLOAD_STATEMENT.FECHA_INICIO_NO_PUEDE_ESTAR_VACIA' })
  startDate: string;

  @IsDateString({}, { message: 'VALIDATION.UPLOAD_STATEMENT.FECHA_FIN_DEBE_FECHA_VALIDA' })
  @IsNotEmpty({ message: 'VALIDATION.UPLOAD_STATEMENT.FECHA_FIN_NO_PUEDE_ESTAR_VACIA' })
  endDate: string;

  @Transform(toNumber)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.UPLOAD_STATEMENT.SALDO_INICIAL_DEBE_NUMERO' })
  startingBalance: number;

  @Transform(toNumber)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'VALIDATION.UPLOAD_STATEMENT.SALDO_FINAL_DEBE_NUMERO' })
  endingBalance: number;

  // ── column mapping ─────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  dateColumn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  descriptionColumn: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  referenceColumn?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  debitColumn?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  creditColumn?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  amountColumn?: string;

  // ── format ─────────────────────────────────────────────────────────────────

  /**
   * How the bank writes a date, in `date-fns` tokens: `dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`.
   *
   * Required, and deliberately so. The importer used to hand the string to `new Date()`, which
   * reads `03/04/2026` as 4 March in the United States and 3 April in most of Latin America — on a
   * product sold in both, that silently moves transactions by up to eleven months.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  dateFormat: string;

  @IsIn(['.', ','])
  @IsOptional()
  decimalSeparator?: '.' | ',';

  /** Whether a positive figure in a single amount column means money arriving. */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  positiveAmountIsMoneyIn?: boolean;
}
