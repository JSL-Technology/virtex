import { IsBoolean } from 'class-validator';

export class UpdateSecuritySettingsDto {
  @IsBoolean()
  requireMfa: boolean;
}
