
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
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AccountType,
  AccountCategory,
  AccountNature,
  AccountRole,
  CashFlowCategory,
  RequiredDimension,
  HierarchyType,
} from '../enums/account-enums';

class StatementMappingDto {
  @IsString() @IsOptional() balanceSheetCategory?: string;
  @IsString() @IsOptional() incomeStatementCategory?: string;
  @IsEnum(CashFlowCategory) @IsOptional() cashFlowCategory?: CashFlowCategory;
}

class RulesDto {
  @IsBoolean() @IsOptional() requiresReconciliation?: boolean;
  @IsBoolean() @IsOptional() isCashOrBank?: boolean;
  @IsBoolean() @IsOptional() allowsIntercompany?: boolean;
  @IsBoolean() @IsOptional() isFxRevaluation?: boolean;
  @IsEnum(RequiredDimension, { each: true })
  @IsOptional()
  requiredDimensions?: RequiredDimension[];
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
  @IsBoolean() @IsOptional() isMultiCurrency?: boolean = false;

  /**
   * The currency an account is designated in (a dollar bank account's ledger account), ISO 4217.
   * Informative and used for display; the revaluation works per (account, currency) from the lines
   * themselves, so a receivable in several currencies needs no designation.
   */
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;


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

  @IsOptional()
  @ValidateNested()
  @Type(() => RulesDto)
  rules?: RulesDto;
}