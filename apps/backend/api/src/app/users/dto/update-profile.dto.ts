import { IsString, IsOptional } from 'class-validator';
import { IsE164PhoneNumber } from '../../common/validators/is-e164-phone-number.validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  @IsE164PhoneNumber({ message: 'Phone number must be in E.164 format (e.g. +18095551234)' })
  phone?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsString()
  preferredLanguage?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
