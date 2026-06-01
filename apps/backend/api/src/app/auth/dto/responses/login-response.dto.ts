
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../user-response.dto';

export class LoginResponseDto {
  @ApiProperty({ type: UserResponseDto, required: false })
  user?: UserResponseDto;

  @ApiProperty({ required: false })
  require2fa?: boolean;

  @ApiProperty({ required: false })
  tempToken?: string;

  @ApiProperty({ required: false })
  message?: string;
}
