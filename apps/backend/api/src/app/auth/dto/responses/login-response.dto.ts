
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../user-response.dto';

export class LoginResponseDto {
  @ApiProperty({ type: UserResponseDto, required: false })
  user?: UserResponseDto;

  @ApiProperty({ required: false })
  require2fa?: boolean;

  // H-03 FIX: tempToken removed — pending session delivered via httpOnly cookie only.
  @ApiProperty({ required: false })
  message?: string;
}
