import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SupplierBankAccountType } from '../entities/supplier-bank-account.entity';

/** A bank account a supplier is paid into (audit 2026-11-07, CMP-17). */
export class CreateSupplierBankAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  bankName: string;

  @IsString()
  @IsOptional()
  @MaxLength(160, { message: 'validation.constraints.max_length|{"max":160}' })
  accountHolder?: string | null;

  @IsEnum(SupplierBankAccountType)
  @IsOptional()
  accountType?: SupplierBankAccountType;

  /** Digits, letters, spaces or dashes; stored encrypted, shown by its last four. */
  @Matches(/^[0-9A-Za-z][0-9A-Za-z \-]{3,39}$/, { message: 'masters.supplier_bank.account_number_invalid' })
  accountNumber: string;

  @Matches(/^[A-Z]{3}$/, { message: 'validation.currency_code' })
  @IsOptional()
  currencyCode?: string | null;

  @Matches(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, { message: 'validation.constraints.bic' })
  @IsOptional()
  swift?: string | null;

  @Matches(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, { message: 'validation.constraints.iban' })
  @IsOptional()
  iban?: string | null;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class UpdateSupplierBankAccountDto extends PartialType(CreateSupplierBankAccountDto) {}
