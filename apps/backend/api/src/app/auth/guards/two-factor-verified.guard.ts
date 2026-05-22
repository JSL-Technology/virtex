
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TwoFactorAuthService } from '../services/two-factor-auth.service';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

@Injectable()
export class TwoFactorVerifiedGuard implements CanActivate {
  constructor(private readonly twoFactorService: TwoFactorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    // 1. Check if 2FA is enabled using the service (handles missing security entity)
    const isEnabled = await this.twoFactorService.isTwoFactorEnabled(user);

    if (!isEnabled) {
      // If 2FA is not enabled, we allow standard auth to suffice.
      return true;
    }

    // 2. Check for OTP code in headers
    // Standardizing on 'x-otp-code'
    const otpCode = request.headers['x-otp-code'];

    if (!otpCode) {
      throw new ForbiddenException('OTP code required for this action');
    }

    // 3. Verify code
    const isValid = await this.twoFactorService.verifyCode(user, otpCode as string);

    if (!isValid) {
      throw new ForbiddenException('Invalid OTP code');
    }

    return true;
  }
}
