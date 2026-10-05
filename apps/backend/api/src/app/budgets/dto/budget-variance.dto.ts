import { IsOptional, IsUUID, Matches } from 'class-validator';

/** A variance report over a run of months, across every budget in it. */
export class BudgetVarianceQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'budgets.period_format' })
  fromPeriod: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'budgets.period_format' })
  toPeriod: string;

  @IsUUID('4')
  @IsOptional()
  ledgerId?: string;
}
