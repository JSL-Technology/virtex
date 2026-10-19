import { Expose, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationResponseDto } from '../../auth/dto/user-response.dto';

/**
 * The company profile, as Settings › Company profile edits it (QA A-02).
 *
 * `GET /organizations/profile` used to serialise through `OrganizationResponseDto`, which is the
 * company HEADER every screen draws — name, tax id, logo, currency — and deliberately nothing
 * more. The profile form read the address, city, state, postal code and industry off that and
 * found nothing, so a tenant who had typed all of it at signup opened the profile to empty fields
 * and concluded the signup had lost it. It had not: the columns were filled, the response simply
 * did not carry them.
 *
 * A dedicated DTO rather than widening the header: the header travels on every session refresh,
 * and the address of the company is not something every screen needs.
 */
export class OrganizationProfileResponseDto extends OrganizationResponseDto {
  @ApiPropertyOptional() @Expose() address: string | null;
  @ApiPropertyOptional() @Expose() city: string | null;
  /** First-level division: a coded value (`TX`, `CMX`, `32`) where the country publishes one. */
  @ApiPropertyOptional() @Expose() state: string | null;
  @ApiPropertyOptional() @Expose() postalCode: string | null;
  @ApiPropertyOptional() @Expose() industry: string | null;
  @ApiPropertyOptional() @Expose() companySize: string | null;
  @ApiPropertyOptional() @Expose() phone: string | null;
  @ApiPropertyOptional() @Expose() website: string | null;
  @ApiPropertyOptional() @Expose() taxpayerKind: string | null;

  /** The stored ISO country, for the form's `country` control (the header calls it `countryCode`). */
  @ApiPropertyOptional()
  @Expose()
  @Transform(({ obj }) => (typeof obj.country === 'string' && obj.country.trim() ? obj.country.trim().toUpperCase() : null))
  country: string | null;

  /**
   * Whether the country can still be changed.
   *
   * Once the tenant is provisioned its chart of accounts, taxes and document sequences belong to
   * one jurisdiction, and `OrganizationsService.update` refuses a change. Sending the answer lets
   * the form lock the field and say why, instead of letting the tenant pick another country and
   * failing on save.
   */
  @ApiPropertyOptional()
  @Expose()
  @Transform(({ obj }) => Boolean(obj.fiscalRegionId && typeof obj.country === 'string' && obj.country.trim()))
  countryLocked: boolean;
}
