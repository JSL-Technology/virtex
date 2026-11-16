
import {
  Matches,
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEnum,
  IsUUID,
  IsBoolean,
  ValidateNested,
  IsObject,
  IsArray,
  ArrayMinSize,
  IsDateString,
  IsIn,
} from 'class-validator';
import { FX_TREATMENTS, type FxTreatment } from '@virtex/shared/types';
import { Type } from 'class-transformer';
import {
  AccountType,
  AccountCategory,
  AccountNature,
  AccountRole,
  CashFlowCategory,
  HierarchyType,
} from '../enums/account-enums';

class StatementMappingDto {
  @IsString() @IsOptional() balanceSheetCategory?: string;
  @IsString() @IsOptional() incomeStatementCategory?: string;
  @IsEnum(CashFlowCategory) @IsOptional() cashFlowCategory?: CashFlowCategory;
}

export class CreateAccountDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: 'validation.constraints.array_min_size|{"min":1}' })
  segments: string[];

  @IsString() @IsNotEmpty() @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' }) name: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(AccountType) @IsNotEmpty() type: AccountType;
  @IsEnum(AccountCategory) @IsNotEmpty() category: AccountCategory;
  @IsEnum(AccountNature) @IsNotEmpty() nature: AccountNature;
  @IsUUID('4') @IsOptional() parentId?: string | null;
  @IsBoolean() @IsOptional() isActive?: boolean = true;
  @IsBoolean() @IsOptional() isPostable?: boolean = false;

  /** Declares that `nature` is deliberately the opposite of the type's normal balance. */
  @IsBoolean() @IsOptional() isContraAccount?: boolean = false;


  /** Operational role, used by the automatic postings to find this account. */
  @IsEnum(AccountRole) @IsOptional() systemRole?: AccountRole;

  @IsBoolean() @IsOptional() isSystemAccount?: boolean = false;

  /**
   * How the account's foreign-currency balances are measured at a period end (IAS 21): restated at
   * the closing rate, or kept at their historical rate. Omitted: from the account's role and type
   * (`defaultFxTreatment`). Only balance-sheet accounts can be revalued.
   */
  @IsOptional()
  @IsIn(FX_TREATMENTS, { message: 'validation.constraints.is_in' })
  fxTreatment?: FxTreatment;

  /**
   * The account's currency, ISO 4217: every line on it is in this currency (a dollar bank account's
   * ledger account takes only dollars, a peso one only pesos). Null: lines in any currency.
   */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'validation.constraints.currency_code' })
  currency?: string | null;


  /**
   * The authority's grouping code (Mexico's SAT «código agrupador»), required by electronic
   * accounting catalogues. The opening plan fills it where the country pack declares one.
   */
  @IsOptional() @IsString() @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  fiscalGroupingCode?: string;

  @IsDateString() @IsOptional() effectiveFrom?: string;
  @IsDateString() @IsOptional() effectiveTo?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StatementMappingDto)
  statementMapping?: StatementMappingDto;

}