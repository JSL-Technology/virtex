import { Expose, Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AuthUserContract,
  OrganizationContract,
  RoleContract,
  UserStatusValue,
} from '@virteex/shared/types';

export class OrganizationResponseDto implements OrganizationContract {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  legalName: string;

  @ApiPropertyOptional()
  @Expose()
  taxId: string | null;

  @ApiPropertyOptional()
  @Expose()
  logoUrl: string | null;

  @ApiPropertyOptional()
  @Expose()
  subscriptionStatus: string | null;

  @ApiPropertyOptional()
  @Expose()
  gracePeriodEnd: string | null;

  // NOT exposed, deliberately: stripeCustomerId / stripeSubscriptionId. The client has no use
  // for them and they are valuable to an attacker enumerating billing accounts.
}

export class RoleResponseDto implements RoleContract {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiPropertyOptional()
  @Expose()
  description: string | null;

  @ApiProperty({ type: [String] })
  @Expose()
  permissions: string[];

  @ApiProperty()
  @Expose()
  isSystemRole: boolean;
}

/**
 * Serialised representation of a user.
 *
 * `implements AuthUserContract` is the point of this class: the contract lives in
 * `@virteex/shared/types` and the frontend `User` interface extends the same declaration, so a
 * field that exists on one side and not the other is now a compile error.
 *
 * Previously this DTO omitted `roles`, `avatarUrl`, `phone`, `jobTitle`, `department`,
 * `isEmailVerified` and `isOnline` while the frontend declared them (several as required) and
 * rendered them. Because serialisation runs with `excludeExtraneousValues: true`, those fields
 * were silently dropped from every response: the members list always showed "Sin rol", the role
 * dropdown never preselected, and the profile screen could not render — or persist — the user's
 * own phone number.
 *
 * Note what is still absent, deliberately: password hashes, TOTP secrets, backup codes,
 * invitation/reset tokens and the entire `security` relation. `ForbiddenUserFields` in the
 * contract enforces that at the type level.
 */
export class UserResponseDto implements AuthUserContract {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  email: string;

  @ApiProperty()
  @Expose()
  firstName: string;

  @ApiProperty()
  @Expose()
  lastName: string;

  @ApiProperty({ enum: ['PENDING', 'ACTIVE', 'INACTIVE', 'ARCHIVED', 'BLOCKED'] })
  @Expose()
  status: UserStatusValue;

  /**
   * Always an array. The UI does `user.roles.map(...)`, so `undefined` here is a runtime crash
   * rather than an empty state — normalise instead of leaving it optional.
   */
  @ApiProperty({ type: [RoleResponseDto] })
  @Expose()
  @Type(() => RoleResponseDto)
  @Transform(({ value }) => value ?? [], { toClassOnly: true })
  roles: RoleResponseDto[];

  @ApiProperty({ type: [String] })
  @Expose()
  @Transform(({ value }) => value ?? [], { toClassOnly: true })
  permissions: string[];

  @ApiPropertyOptional()
  @Expose()
  organizationId: string | null;

  @ApiPropertyOptional({ type: OrganizationResponseDto })
  @Expose()
  @Type(() => OrganizationResponseDto)
  @Transform(({ value }) => value ?? null, { toClassOnly: true })
  organization: OrganizationResponseDto | null;

  @ApiProperty({ type: [OrganizationResponseDto] })
  @Expose()
  @Type(() => OrganizationResponseDto)
  @Transform(({ value }) => value ?? [], { toClassOnly: true })
  organizations: OrganizationResponseDto[];

  // ---- Profile ----
  @ApiPropertyOptional()
  @Expose()
  avatarUrl: string | null;

  @ApiPropertyOptional()
  @Expose()
  phone: string | null;

  @ApiPropertyOptional()
  @Expose()
  jobTitle: string | null;

  @ApiPropertyOptional()
  @Expose()
  department: string | null;

  @ApiPropertyOptional()
  @Expose()
  preferredLanguage: string | null;

  // ---- Account state ----
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => value ?? false, { toClassOnly: true })
  isEmailVerified: boolean;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => value ?? false, { toClassOnly: true })
  isPhoneVerified: boolean;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => value ?? false, { toClassOnly: true })
  isTwoFactorEnabled: boolean;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => value ?? false, { toClassOnly: true })
  isOnline: boolean;

  @ApiPropertyOptional()
  @Expose()
  lastActivity: string | null;

  @ApiPropertyOptional()
  @Expose()
  createdAt: string | null;

  // ---- Impersonation context ----
  @ApiPropertyOptional()
  @Expose()
  isImpersonating?: boolean;

  @ApiPropertyOptional()
  @Expose()
  originalUserId?: string | null;
}
