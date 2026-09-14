import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RegisterUserDto } from './register-user.dto';
import { BILLING_PERIODS, type BillingPeriod } from '../../saas/enums/billing-period.enum';

/**
 * Payment-first signup payload: the full registration plus the chosen plan.
 * No account is created from this — it produces a Stripe Checkout session.
 */
export class RegisterCheckoutDto extends RegisterUserDto {
  @ApiProperty({ example: 'pro', description: 'Selected plan slug or id' })
  @IsString({ message: 'validation.register_checkout.selected_plan_not_valid' })
  @IsNotEmpty({ message: 'validation.register_checkout.you_must_select_plan' })
  planId: string;

  /**
   * Monthly or annual. Defaults to monthly, which is what every signup was charged before annual
   * billing existed anywhere but on an unused column.
   */
  @ApiProperty({ enum: BILLING_PERIODS, required: false, default: 'monthly' })
  @IsOptional()
  @IsIn(BILLING_PERIODS, { message: 'validation.register_checkout.billing_period_not_valid' })
  billingPeriod?: BillingPeriod;
}
