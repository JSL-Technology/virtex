import { IsDateString, IsNotEmpty } from 'class-validator';

/**
 * The window a profitability report covers.
 *
 * Both dates are required. A margin without a period is not a figure anyone can act on: the same
 * product looks very different over a quarter and over a launch week, and defaulting the range
 * silently would let two readers compare numbers that cover different months.
 */
export class ProfitabilityQueryDto {
  @IsDateString({}, { message: 'validation.constraints.property_not_valid_date' })
  @IsNotEmpty()
  startDate: string;

  @IsDateString({}, { message: 'validation.constraints.property_not_valid_date' })
  @IsNotEmpty()
  endDate: string;
}
