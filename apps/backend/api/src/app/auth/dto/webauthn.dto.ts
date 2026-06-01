import { IsObject, IsString, IsNotEmpty } from 'class-validator';

// H13 FIX: Typed DTOs replace body:any for WebAuthn endpoints.
export class VerifyWebAuthnRegistrationDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  rawId: string;

  @IsObject()
  response: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  type: string;
}

export class VerifyWebAuthnAuthenticationDto {
  @IsObject()
  credential: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  challengeId: string;
}
