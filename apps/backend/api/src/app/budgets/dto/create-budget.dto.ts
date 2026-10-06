import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class BudgetLineDto {
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  amount: number;

  /** Cost centre, project… — a line can target one combination of dimension values. */
  @IsObject()
  @IsOptional()
  dimensions?: Record<string, string>;
}

/** A month's budget: what each account (optionally per dimension) is expected to spend or earn. */
export class CreateBudgetDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120, { message: 'validation.constraints.max_length|{"max":120}' })
  name: string;

  /** `YYYY-MM` — the month the budget and its control apply to. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'budgets.period_format' })
  period: string;

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}

/** Copy a budget into other months — the usual way a year's budget is laid down. */
export class CopyBudgetDto {
  @IsArray()
  @ArrayMaxSize(24)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { each: true, message: 'budgets.period_format' })
  periods: string[];

  /** Applied to every amount: 1.05 copies March into April five per cent higher. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0, { message: 'validation.constraints.min|{"min":0}' })
  @IsOptional()
  factor?: number;
}
