import { IsString, IsNotEmpty, IsIn, IsOptional, Equals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LEGAL_DOCUMENTS } from '@virteex/shared/types';
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

  /**
   * Express acceptance of the Terms of service and the Privacy policy (QA C-07).
   *
   * The checkbox existed and nothing read it: the payload carried no acceptance at all and the
   * account was created either way. It is now required here, not only in the browser — a client
   * that skips the box, or a script posting straight to this route, is refused before anything is
   * stored. `Equals(true)` and not `IsBoolean`: `false` is a well-formed refusal, not an answer.
   */
  @ApiProperty({ example: true, description: 'Terms of service and Privacy policy accepted' })
  @Equals(true, { message: 'validation.register_checkout.terms_must_be_accepted' })
  acceptTerms: boolean;

  /**
   * Which editions were on screen when the box was ticked.
   *
   * Only the edition in force is accepted. A tab left open across a publication would otherwise
   * record acceptance of a text the person never saw; refusing it makes the page reload and show
   * the current one.
   */
  @ApiProperty({ example: LEGAL_DOCUMENTS.terms.version, description: 'Edition of the Terms accepted' })
  @IsIn([LEGAL_DOCUMENTS.terms.version], { message: 'validation.register_checkout.legal_version_outdated' })
  termsVersion: string;

  @ApiProperty({ example: LEGAL_DOCUMENTS.privacy.version, description: 'Edition of the Privacy policy accepted' })
  @IsIn([LEGAL_DOCUMENTS.privacy.version], { message: 'validation.register_checkout.legal_version_outdated' })
  privacyVersion: string;
}
