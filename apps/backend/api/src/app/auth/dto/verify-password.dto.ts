
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyPasswordDto {
  @ApiProperty({ description: 'The current password of the user' })
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiProperty({ description: 'The scope for which the step-up token is requested' })
  @IsString()
  @IsNotEmpty()
  scope!: string;
}
