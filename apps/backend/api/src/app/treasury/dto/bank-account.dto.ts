import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BankAccountType } from '../entities/bank-account.entity';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';

export class CreateBankAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  bankName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  accountNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(34)
  iban?: string;

  @IsString()
  @IsOptional()
  @MaxLength(11)
  swiftBic?: string;

  @IsEnum(BankAccountType)
  @IsOptional()
  accountType?: BankAccountType;

  @IsString()
  @Length(3, 3)
  currencyCode: string;

  /** The chart-of-accounts entry this account posts to. */
  @IsUUID()
  @IsNotEmpty()
  glAccountId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  openingBalance?: number;

  @IsDateString()
  @IsOptional()
  openingDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateBankAccountDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  bankName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  accountNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(34)
  iban?: string;

  @IsString()
  @IsOptional()
  @MaxLength(11)
  swiftBic?: string;

  @IsEnum(BankAccountType)
  @IsOptional()
  accountType?: BankAccountType;

  /**
   * Deliberately absent: currency and control account are not editable.
   *
   * Movements already posted were measured in the old currency and landed in the old account.
   * Relabelling either without restating them reinterprets history silently, so a change of either
   * means a new bank account.
   */

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

/**
 * The cut-off of a cash position.
 *
 * Optional, and deliberately left unresolved here: the default is *today in the tenant's own time
 * zone*, which only the server can work out. The route used to substitute `new Date()`, read back
 * in UTC, so a treasurer in Santo Domingo asking for today's cash after 20:00 got tomorrow's date.
 */
export class CashPositionQueryDto {
  @ApiPropertyOptional({ description: 'Fecha de corte (AAAA-MM-DD). Por defecto, hoy en la zona horaria del inquilino.' })
  @IsIsoDate()
  @IsOptional()
  asOfDate?: string;
}
