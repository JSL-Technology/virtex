
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../user-response.dto';
import { SessionPolicyDto } from './session-policy.dto';

export class LoginResponseDto {
  @ApiProperty({ type: UserResponseDto, required: false })
  user?: UserResponseDto;

  @ApiProperty({ required: false })
  require2fa?: boolean;

  @ApiProperty({ type: SessionPolicyDto, required: false })
  session?: SessionPolicyDto;

  // H-03 FIX: tempToken removed — pending session delivered via httpOnly cookie only.
  @ApiProperty({ required: false })
  message?: string;
}
