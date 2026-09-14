import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * The window a budget is compared over.
 *
 * All three are optional: the period defaults to the month the budget names, and the ledger to the
 * tenant's default book. A caller that has to restate the period a budget already carries is one
 * typo away from comparing March spend against the April target.
 */
export class BudgetVsActualQueryDto {
  @IsDateString({}, { message: 'validation.constraints.property_not_valid_date' })
  @IsOptional()
  startDate?: string;

  @IsDateString({}, { message: 'validation.constraints.property_not_valid_date' })
  @IsOptional()
  endDate?: string;

  @IsUUID('4')
  @IsOptional()
  ledgerId?: string;
}
