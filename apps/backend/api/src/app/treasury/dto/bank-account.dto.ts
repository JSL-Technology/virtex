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
import { BankAccountType } from '../entities/bank-account.entity';

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
