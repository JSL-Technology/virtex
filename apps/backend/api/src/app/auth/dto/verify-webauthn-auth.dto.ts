import { IsObject, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyWebAuthnAuthDto {
  @ApiProperty({ description: 'WebAuthn credential assertion response from the browser' })
  @IsObject()
  credential!: Record<string, unknown>;

  @ApiProperty({ description: 'Challenge ID issued during options generation' })
  @IsString()
  challengeId!: string;
}
