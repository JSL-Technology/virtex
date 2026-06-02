import { IsString, IsOptional, MaxLength, Matches, IsUrl } from 'class-validator';
import { IsE164PhoneNumber } from '../../common/validators/is-e164-phone-number.validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @IsE164PhoneNumber({ message: 'Phone number must be in E.164 format (e.g. +18095551234)' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  jobTitle?: string;

  // H-01 FIX: Email cannot be changed through the generic profile update.
  // Use POST /users/profile/email-change/request + confirm flow instead.
  // The field is intentionally omitted so the ValidationPipe (whitelist: true)
  // strips it from any incoming payload before it reaches the service.
  // (OWASP ASVS V2 Authentication; CWE-620 Unverified Password Change)

  // H-16 FIX: Constrain preferredLanguage to BCP-47 language tags (e.g. "en", "es", "en-US")
  // and avatarUrl to a valid HTTPS URL with a reasonable length cap
  // (OWASP ASVS 5.1.3/5.1.4; CWE-20 Improper Input Validation).
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/, { message: 'preferredLanguage must be a BCP-47 tag (e.g. "en" or "es-DO")' })
  @MaxLength(5)
  preferredLanguage?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'avatarUrl must be a valid HTTPS URL' })
  @MaxLength(2048)
  avatarUrl?: string;
}
