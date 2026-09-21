import { IsArray, IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class GrantConsentDto {
  /** Capabilities the tenant grants this extension (e.g. `egress:http`). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grantedCapabilities?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * The exact version this tenant is agreeing to run.
   *
   * Consent used to be to a NAME: execution resolved "the newest version in the catalogue", so a
   * version published after the tenant reviewed and installed the extension inherited that consent
   * — and the capabilities granted with it — automatically. Naming the version is what turns a
   * release into a proposal the tenant accepts rather than a deployment into their tenant.
   *
   * Omitted on a first consent, the version current at that moment is pinned. Omitted later, the
   * existing pin is kept: silence is not acceptance of a pending upgrade.
   */
  @IsOptional()
  @IsUUID()
  versionId?: string;
}
