import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class GrantConsentDto {
  /** Capabilities the tenant grants this extension (e.g. `egress:http`). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grantedCapabilities?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
