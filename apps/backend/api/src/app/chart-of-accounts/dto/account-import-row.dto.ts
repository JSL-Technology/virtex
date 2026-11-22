import { IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { FX_TREATMENTS, type FxTreatment } from '@virtex/shared/types';
import { SpreadsheetBoolean, UpperCaseCode } from '../../common/transformers/spreadsheet-boolean.transformer';
import { AccountCategory, AccountNature, AccountRole, AccountType } from '../enums/account-enums';

/**
 * One account of an imported chart, as a spreadsheet row carries it (FIN-COA-05).
 *
 * The same columns the export writes, so a chart exported from here — or from another company of
 * the group — imports as it is. The code is the account's segments joined by `-`, as on the form;
 * the parent is named by its code, in the file or already in the chart.
 *
 * What is left blank is derived as the form derives it: the nature from the type (the opposite one
 * for a contra account), whether the account takes postings from whether another row hangs from it,
 * and the foreign-currency treatment from the type, the role and that (`defaultFxTreatment`).
 */
export class AccountImportRowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: 'validation.constraints.max_length|{"max":200}' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  name!: string;

  @UpperCaseCode()
  @IsEnum(AccountType)
  type!: AccountType;

  @UpperCaseCode()
  @IsEnum(AccountCategory)
  category!: AccountCategory;

  @IsOptional()
  @UpperCaseCode()
  @IsEnum(AccountNature)
  nature?: AccountNature;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'validation.constraints.max_length|{"max":200}' })
  parentCode?: string;

  /** Blank: it takes postings unless another account hangs from it. */
  @IsOptional()
  @SpreadsheetBoolean()
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @SpreadsheetBoolean()
  @IsBoolean()
  isActive?: boolean;

  /** Its balance runs against its type: accumulated depreciation, an allowance, returns. */
  @IsOptional()
  @SpreadsheetBoolean()
  @IsBoolean()
  isContraAccount?: boolean;

  /** ISO 4217: every line on the account is in it. Blank: lines in any currency. */
  @IsOptional()
  @UpperCaseCode()
  @Matches(/^[A-Z]{3}$/, { message: 'validation.constraints.currency_code' })
  currency?: string;

  @IsOptional()
  @UpperCaseCode()
  @IsIn(FX_TREATMENTS, { message: 'validation.constraints.is_in' })
  fxTreatment?: FxTreatment;

  /** The operational role the automatic postings find the account by; one account per role. */
  @IsOptional()
  @UpperCaseCode()
  @IsEnum(AccountRole)
  systemRole?: AccountRole;

  /**
   * Restated for inflation (IAS 29): only a postable non-monetary account can be. Blank: every one
   * that can be is (`defaultInflationRestatement`).
   */
  @IsOptional()
  @SpreadsheetBoolean()
  @IsBoolean()
  isInflationAdjustable?: boolean;

  /**
   * The code of the account its restatement is posted to, when it stays at nominal value itself
   * (capital → «Ajuste de capital»): in the file or already in the chart.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'validation.constraints.max_length|{"max":50}' })
  inflationAdjustmentAccountCode?: string;

  /** The authority's grouping code (Mexico's SAT «código agrupador»). */
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'validation.constraints.max_length|{"max":20}' })
  fiscalGroupingCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'validation.constraints.max_length|{"max":1000}' })
  description?: string;
}
