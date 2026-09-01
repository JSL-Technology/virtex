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
  @IsString({ message: 'VALIDATION.REGISTER_CHECKOUT.PLAN_SELECCIONADO_NO_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.REGISTER_CHECKOUT.DEBES_SELECCIONAR_PLAN' })
  planId: string;

  /**
   * Monthly or annual. Defaults to monthly, which is what every signup was charged before annual
   * billing existed anywhere but on an unused column.
   */
  @ApiProperty({ enum: BILLING_PERIODS, required: false, default: 'monthly' })
  @IsOptional()
  @IsIn(BILLING_PERIODS, { message: 'VALIDATION.REGISTER_CHECKOUT.PERIODO_FACTURACION_NO_VALIDO' })
  billingPeriod?: BillingPeriod;
}
