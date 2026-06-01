import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

export class AuthResponseDto {
  @ApiProperty({ type: () => UserResponseDto })
  user!: UserResponseDto;
}

export class TwoFactorRequiredDto {
  @ApiProperty()
  require2fa!: boolean;

  @ApiProperty()
  message!: string;
}
