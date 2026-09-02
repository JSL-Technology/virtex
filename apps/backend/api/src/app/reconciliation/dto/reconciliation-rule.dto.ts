import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  RuleAction,
  RuleConditionField,
  RuleConditionOperator,
  RuleDirection,
} from '../entities/reconciliation-rule.entity';

/**
 * A standing instruction for recognisable statement lines.
 *
 * Rules had no DTO and no endpoint: the entity existed and nothing could create one, so the
 * auto-reconciliation loop iterated an empty list on every run.
 */
export class CreateReconciliationRuleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsEnum(RuleConditionField)
  conditionField: RuleConditionField;

  @IsEnum(RuleConditionOperator)
  conditionOperator: RuleConditionOperator;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  conditionValue: string;

  @IsEnum(RuleDirection)
  @IsOptional()
  direction?: RuleDirection;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amountMin?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amountMax?: number;

  /**
   * `MATCH_EXISTING` clears against a ledger line that is already there. `CREATE_ENTRY` posts the
   * entry the books are missing, and only for movements the bank itself originated — a charge,
   * interest credited — because posting one for a movement already recorded double-counts it.
   */
  @IsEnum(RuleAction)
  @IsOptional()
  action?: RuleAction;

  @IsUUID()
  @IsOptional()
  targetAccountId?: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  @IsOptional()
  priority?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateReconciliationRuleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsEnum(RuleConditionField)
  @IsOptional()
  conditionField?: RuleConditionField;

  @IsEnum(RuleConditionOperator)
  @IsOptional()
  conditionOperator?: RuleConditionOperator;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  conditionValue?: string;

  @IsEnum(RuleDirection)
  @IsOptional()
  direction?: RuleDirection;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amountMin?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amountMax?: number | null;

  @IsEnum(RuleAction)
  @IsOptional()
  action?: RuleAction;

  @IsUUID()
  @IsOptional()
  targetAccountId?: string | null;

  @IsInt()
  @Min(1)
  @Max(10_000)
  @IsOptional()
  priority?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
