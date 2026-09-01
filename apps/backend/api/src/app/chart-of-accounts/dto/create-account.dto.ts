
import {
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
  @ArrayMinSize(1, { message: 'VALIDATION.CONSTRAINTS.ARRAY_MIN_SIZE|{"min":1}' })
  segments: string[];

  @IsString() @IsNotEmpty() @MaxLength(255, { message: 'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":255}' }) name: string;
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