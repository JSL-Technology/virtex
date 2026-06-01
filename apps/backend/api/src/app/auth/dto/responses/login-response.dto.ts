
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../user-response.dto';

export class TokensDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ required: false })
  refreshTokenId?: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: UserResponseDto, required: false })
  user?: UserResponseDto;

  @ApiProperty({ required: false })
  accessToken?: string;

  @ApiProperty({ required: false })
  refreshToken?: string;

  @ApiProperty({ required: false })
  require2fa?: boolean;

  // H-03 FIX: tempToken removed — pending session delivered via httpOnly cookie only.
  @ApiProperty({ required: false })
  message?: string;
}
