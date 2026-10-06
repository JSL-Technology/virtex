import { PickType } from '@nestjs/swagger';
import { RegisterCheckoutDto } from './register-checkout.dto';

/**
 * A signed-in person adding another company: the company half of the signup form and the plan.
 *
 * Picked from the signup DTO rather than written again, so both forms validate a company the same
 * way. The person half — name, email, password, verification codes, reCAPTCHA — is absent on
 * purpose: it comes from the session.
 */
export class AddCompanyCheckoutDto extends PickType(RegisterCheckoutDto, [
  'organizationName',
  'countryCode',
  'taxpayerKind',
  'taxId',
  'fiscalProfile',
  'industry',
  'companySize',
  'address',
  'city',
  'state',
  'postalCode',
  'planId',
  'billingPeriod',
] as const) {}

/** The company fields alone, as the registration service reads them. */
export type AdditionalCompanyFields = Omit<AddCompanyCheckoutDto, 'planId' | 'billingPeriod'>;
