import { Controller } from '@nestjs/common';

/**
 * Reserved for cross-cutting endpoints that belong to no single module.
 *
 * It previously exposed two @Public() existence probes:
 *
 *   HEAD /common/users/exists?email=…          200 when the address is registered, 404 otherwise
 *   HEAD /common/organizations/exists?taxId=…  200 when the tax id is registered, 404 otherwise
 *
 * The first is a plain account-enumeration oracle, and it undid the entire anti-enumeration
 * design of the auth module: the login path verifies the password before checking account state
 * and pays a dummy Argon2 cost for unknown addresses precisely so that no request can distinguish
 * a registered address from an unregistered one, and registration returns the same message for a
 * duplicate as for a success. One unauthenticated HEAD request answered the question directly.
 *
 * The second was worse in an ERP: tax ids are public in several of the markets this product
 * serves, so anyone could enumerate which companies are customers — competitive intelligence
 * about the customer base, disclosed by the product itself.
 *
 * The registration form used them for live feedback. That check now happens server-side when the
 * form is submitted, where the answer is only revealed to someone who has already proven they
 * control the address (see RegistrationService.validateRegistration).
 */
@Controller('common')
export class CommonController {}
