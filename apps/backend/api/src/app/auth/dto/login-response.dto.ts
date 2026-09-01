import { ApiProperty } from '@nestjs/swagger';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { User } from '../../users/entities/user.entity/user.entity';

/**
 * What the login SERVICE returns internally — tokens included.
 *
 * Renamed from `LoginResponseDto`, which was also the name of the HTTP response DTO in
 * `dto/responses/login-response.dto.ts`. Both were imported into `auth.controller.ts` at once, and
 * the two shapes are opposites on the point that matters: this one declares `accessToken` and
 * `refreshToken` as required, while the HTTP one deliberately omits them because tokens are
 * delivered only as httpOnly cookies. Two different meanings under one name, in one file, is how
 * a token ends up in a response body.
 */
export class AuthenticatedLoginResult {
    @ApiProperty({ type: () => User })
    user: AuthenticatedUser;

    @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
    accessToken: string;

    @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
    refreshToken: string;

    @ApiProperty({ example: 'uuid-string' })
    refreshTokenId: string;
}

/**
 * H-03 FIX: No tempToken — the pending session id is delivered only via an httpOnly cookie.
 *
 * `pendingId` is declared here, without `@ApiProperty`, because it is an INTERNAL field: the
 * controller reads it to set the cookie and it is never serialised into the response body. It used
 * to be absent from the type entirely, so the controller reached it through `(result as any)` —
 * which is the same thing as having no type at all, and would have silently returned `undefined`
 * had the service ever stopped producing it.
 */
export class TwoFactorRequiredResponseDto {
    @ApiProperty({ example: true })
    require2fa: boolean;

    /**
     * A catalogue key, resolved into `message` by `LocaleInterceptor` on the way out.
     *
     * It used to be the literal string "2FA verification required" — English, in a product whose
     * interface is Spanish, on the one screen a reader reaches before they have signed in and
     * therefore before the server knows anything about them except what they asked for.
     */
    @ApiProperty({ example: 'AUTH.TWO_FACTOR_REQUIRED' })
    messageKey: string;

    /** Internal only. Set as an httpOnly cookie by the controller; never sent in the body. */
    pendingId?: string;
}

export type LoginResultDto = AuthenticatedLoginResult | TwoFactorRequiredResponseDto;
