
import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SocialUser } from '../interfaces/social-user.interface';
import { AuthError } from '../enums/auth-error.enum';

export const SocialUserDecorator = createParamDecorator(
  (data: keyof SocialUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    const user = request.user as SocialUser;

    if (!user) {
        throw new UnauthorizedException(AuthError.INVALID_CREDENTIALS); // Or appropriate error
    }

    return data ? user?.[data] : user;
  }
);
