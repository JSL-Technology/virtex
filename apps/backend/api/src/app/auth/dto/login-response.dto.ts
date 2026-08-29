import { ApiProperty } from '@nestjs/swagger';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { User } from '../../users/entities/user.entity/user.entity';

export class LoginResponseDto {
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

    @ApiProperty({ example: '2FA verification required' })
    message: string;

    /** Internal only. Set as an httpOnly cookie by the controller; never sent in the body. */
    pendingId?: string;
}

export type LoginResultDto = LoginResponseDto | TwoFactorRequiredResponseDto;
