import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnableTwoFactorDto {
  @ApiProperty({
    description: 'The TOTP token from the authenticator app',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
