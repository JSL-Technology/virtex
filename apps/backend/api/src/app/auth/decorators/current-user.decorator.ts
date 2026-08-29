import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * The principal for the current request.
 *
 * Typed as `AuthenticatedUser`, not as the `User` entity. That distinction is the whole point:
 * `User.organizationId` is `string | null`, because the column is nullable, whereas a principal
 * that has passed the auth guard always has a tenant — `UserIdentityService` refuses the request
 * otherwise. Typing this as the entity pushed that nullability into all 52 controllers, where it
 * produced 193 `'string | null' is not assignable to 'string'` errors and, in the code that
 * ignored them, the assumption that the value was present with nothing enforcing it.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser;
    return data ? user?.[data] : user;
  },
);
