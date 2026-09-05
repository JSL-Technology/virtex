import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { LanguageCode, SUPPORTED_LANGUAGES } from '@virteex/shared/types';
import { NormalizeEmail } from '../../../common/transformers/normalize-email.transformer';

export class InviteUserDto {
  // Invited under the canonical case so the invitee later logs in against the same address the
  // invitation created, and a duplicate invite in a different case is caught, not created.
  @NormalizeEmail()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsUUID()
  @IsNotEmpty()
  roleId: string;


  @IsString()
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES as readonly string[], {
    message: `preferredLanguage must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
  })
  preferredLanguage?: LanguageCode;

}