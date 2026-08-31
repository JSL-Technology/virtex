import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { LanguageCode, SUPPORTED_LANGUAGES } from '@virteex/shared/types';

export class InviteUserDto {
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