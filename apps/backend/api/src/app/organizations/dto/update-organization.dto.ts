import { IsString, IsOptional, IsUrl, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  /**
   * First-level division and postal code. Collected at signup and stored on the organization, but
   * the profile could neither show nor edit them, so a tenant who moved had no way to correct the
   * fiscal address their documents carry (QA A-02).
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsString()
  industry?: string;
}
