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

// H-03 FIX: No tempToken — the pending session ID is delivered only via an httpOnly cookie.
export class TwoFactorRequiredResponseDto {
    @ApiProperty({ example: true })
    require2fa: boolean;

    @ApiProperty({ example: '2FA verification required' })
    message: string;
}

export type LoginResultDto = LoginResponseDto | TwoFactorRequiredResponseDto;
