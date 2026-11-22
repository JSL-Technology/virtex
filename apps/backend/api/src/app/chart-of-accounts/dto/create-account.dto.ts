
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
  /*
   * No property initializers on this DTO: `UpdateAccountDto` is its `PartialType`, which copies
   * initializers into every instance — so `isPostable = false` here made every PATCH that left it
   * out a request to turn the account into a summary account (refused once it had lines, silently
   * done before), `isActive = true` reactivated a deactivated account on any edit, and
   * `isContraAccount = false` took the mark off accumulated depreciation when it was renamed. The
   * defaults live where an account is created: the service (`isPostable ?? false`) and the columns.
   */
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsBoolean() @IsOptional() isPostable?: boolean;

  /** Declares that `nature` is deliberately the opposite of the type's normal balance. */
  @IsBoolean() @IsOptional() isContraAccount?: boolean;


  /** Operational role, used by the automatic postings to find this account. */
  @IsEnum(AccountRole) @IsOptional() systemRole?: AccountRole;

  @IsBoolean() @IsOptional() isSystemAccount?: boolean;

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
   * Whether the restatement for inflation restates the account (IAS 29). Omitted: every postable
   * non-monetary account is restated (`defaultInflationRestatement`); a monetary account, a summary
   * account and the account of the net monetary position cannot be.
   */
  @IsOptional()
  @IsBoolean()
  isInflationAdjustable?: boolean;

  /**
   * The account the restatement is posted to, when the account itself stays at its nominal value
   * (capital → «Ajuste de capital»). Null: the account itself.
   */
  @IsOptional()
  @IsUUID('4', { message: 'validation.constraints.is_uuid' })
  inflationAdjustmentAccountId?: string | null;


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