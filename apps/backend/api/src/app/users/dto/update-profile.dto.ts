import { IsString, IsOptional, MaxLength, IsIn, IsUrl } from 'class-validator';
import { IsE164PhoneNumber } from '../../common/validators/is-e164-phone-number.validator';
import { LanguageCode, SUPPORTED_LANGUAGES } from '@virteex/shared/types';

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

  /**
   * The interface language, constrained to a catalogue that actually exists.
   *
   * This accepted any well-formed BCP-47 tag, so `fr-FR` was stored happily — and then nothing
   * could render it: `LanguageService.setLanguage` ignores an unsupported code, the profile
   * `<select>` has no matching option, and the link builder falls back to Spanish. The value was
   * accepted, persisted, and unreachable. The invitation endpoint meanwhile used
   * `@IsIn(['en','es'])`, so the same field had two different contracts depending on which door
   * it came through. Both now read the one catalogue.
   *
   * (OWASP ASVS 5.1.3/5.1.4; CWE-20 Improper Input Validation.)
   */
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES as readonly string[], {
    message: `preferredLanguage must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
  })
  preferredLanguage?: LanguageCode;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'avatarUrl must be a valid HTTPS URL' })
  @MaxLength(2048)
  avatarUrl?: string;
}
