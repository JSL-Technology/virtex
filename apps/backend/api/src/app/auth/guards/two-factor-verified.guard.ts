
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TwoFactorAuthService } from '../services/two-factor-auth.service';
import { UserCacheService } from '../modules/user-cache.service';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

const STEP_UP_MAX_ATTEMPTS = 5;
const STEP_UP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class TwoFactorVerifiedGuard implements CanActivate {
  constructor(
    private readonly twoFactorService: TwoFactorAuthService,
    private readonly userCacheService: UserCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    const isEnabled = await this.twoFactorService.isTwoFactorEnabled(user);

    if (!isEnabled) {
      return true;
    }

    const otpCode = request.headers['x-otp-code'];

    if (!otpCode) {
      throw new ForbiddenException('OTP code required for this action');
    }

    // Rate limiting: max STEP_UP_MAX_ATTEMPTS per STEP_UP_WINDOW_MS per user (CWE-307)
    const rateLimitKey = `step-up-attempts:${user.id}`;
    const cached = await this.userCacheService.get<number>(rateLimitKey);
    const attempts = cached != null ? cached : 0;

    if (attempts >= STEP_UP_MAX_ATTEMPTS) {
      throw new ForbiddenException('Too many step-up authentication attempts. Please wait 5 minutes.');
    }

    await this.userCacheService.set(rateLimitKey, attempts + 1, STEP_UP_WINDOW_MS);

    const isValid = await this.twoFactorService.verifyCode(user, otpCode as string);

    if (isValid) {
      await this.userCacheService.del(rateLimitKey);
      return true;
    }

    throw new ForbiddenException('Invalid OTP code');
  }
}
