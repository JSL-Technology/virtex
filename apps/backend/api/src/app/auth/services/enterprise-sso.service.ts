import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { IdentityProvider } from '../entities/identity-provider.entity';
import { OrganizationDomain } from '../../organizations/entities/organization-domain.entity';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { Role } from '../../roles/entities/role.entity';
import { SocialUser } from '../interfaces/social-user.interface';
import { OidcClientConfig, OidcProviderService } from './oidc-provider.service';
import { SecretEncryptionService } from './secret-encryption.service';
import { TokenService } from './token.service';
import { UsersService } from '../../users/users.service';
import { AuditTrailService } from '../../audit/audit.service';
import { ActionType } from '../../audit/entities/audit-log.entity';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../i18n/localized.exception';

/**
 * Enterprise SSO (Phase 2): vendor-neutral, per-tenant OIDC. The flow mirrors the social
 * login handshake (same OauthStateService + OidcProviderService) but the client config comes
 * from a per-organization IdentityProvider record instead of environment variables.
 *
 * The app's IAM stays the source of truth: the IdP verifies the email once, then this
 * service maps/provisions the user inside the resolved organization and issues the app's own
 * JWT session via TokenService.
 */
@Injectable()
export class EnterpriseSsoService {
  private readonly logger = new Logger(EnterpriseSsoService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(IdentityProvider)
    private readonly idpRepository: Repository<IdentityProvider>,
    @InjectRepository(OrganizationDomain)
    private readonly domainRepository: Repository<OrganizationDomain>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly oidcProviderService: OidcProviderService,
    private readonly secretEncryption: SecretEncryptionService,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditTrailService,
    private readonly configService: ConfigService,
  ) {}

  private hashPii(value: string): string {
    return crypto.createHash('sha256').update((value || '').toLowerCase().trim()).digest('hex').slice(0, 12);
  }

  /** Extract and normalize the domain part of an email address. */
  getDomainFromEmail(email: string): string | null {
    const at = email.lastIndexOf('@');
    if (at < 0) return null;
    const domain = email.slice(at + 1).trim().toLowerCase();
    return domain || null;
  }

  /**
   * Home Realm Discovery: given an email, find the enabled enterprise IdP whose organization
   * owns the (verified) email domain. Returns null when there is no SSO connection — the
   * caller then falls back to normal login. Intentionally does not reveal whether the domain
   * exists to avoid tenant enumeration.
   */
  async discoverByEmail(email: string): Promise<{ idpId: string; idpName: string } | null> {
    const domain = this.getDomainFromEmail(email);
    if (!domain) return null;

    const orgDomain = await this.domainRepository.findOne({
      where: { domain, verified: true },
    });
    if (!orgDomain) return null;

    const idp = await this.idpRepository.findOne({
      where: { organizationId: orgDomain.organizationId, enabled: true },
    });
    if (!idp) return null;

    return { idpId: idp.id, idpName: idp.name };
  }

  async getEnabledIdpOrThrow(idpId: string): Promise<IdentityProvider> {
    const idp = await this.idpRepository.findOne({ where: { id: idpId, enabled: true } });
    if (!idp) {
      throw new NotFoundError('AUTH.SSO_CONNECTION_NOT_FOUND_OR_DISABLED');
    }
    return idp;
  }

  /** Build the shared OIDC client config from a stored IdP record (decrypting the secret). */
  buildConfig(idp: IdentityProvider): OidcClientConfig {
    const apiBase = this.configService.get<string>('API_PUBLIC_URL', 'http://localhost:3000/api/v1');
    return {
      key: `sso:${idp.id}`,
      issuerUrl: idp.issuerUrl,
      clientId: idp.clientId,
      clientSecret: this.secretEncryption.decrypt(idp.clientSecretEncrypted),
      redirectUri: `${apiBase.replace(/\/$/, '')}/auth/sso/${idp.id}/callback`,
      scope: (idp.scopes?.length ? idp.scopes : ['openid', 'email', 'profile']).join(' '),
      issuerValidation: 'exact',
    };
  }

  /**
   * Complete an SSO callback: validate the IdP assertion, enforce that the email domain
   * belongs to the IdP's organization, then log in an existing user or JIT-provision a new
   * one inside that organization, and issue the app's own session tokens.
   */
  async loginOrProvision(
    idp: IdentityProvider,
    socialUser: SocialUser,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ user: User; tokens: any }> {
    // The IdP must assert a verified email; otherwise account takeover is possible.
    if (!socialUser.emailVerified) {
      throw new UnauthorizedError('AUTH.IDENTITY_PROVIDER_DID_NOT_VERIFY_EMAIL_ADDRESS');
    }

    // Defense in depth: the email domain must be a verified domain of the IdP's organization.
    const domain = this.getDomainFromEmail(socialUser.email);
    const orgDomain = domain
      ? await this.domainRepository.findOne({
          where: { domain, organizationId: idp.organizationId, verified: true },
        })
      : null;
    if (!orgDomain) {
      throw new UnauthorizedError('AUTH.EMAIL_DOMAIN_NOT_AUTHORIZED_FOR_THIS_SSO');
    }

    let user = await this.usersService.findUserForAuth(socialUser.email);

    if (user) {
      // Never let an SSO login cross tenant boundaries.
      if (user.organizationId !== idp.organizationId) {
        throw new UnauthorizedError('AUTH.THIS_ACCOUNT_BELONGS_DIFFERENT_ORGANIZATION');
      }
      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedError('AUTH.USER_INACTIVE_OR_BLOCKED');
      }
    } else {
      user = await this.provisionUser(idp, socialUser);
    }

    await this.auditService.record(
      user.id,
      'User',
      user.id,
      ActionType.LOGIN,
      {
        emailHash: this.hashPii(user.email),
        provider: 'sso',
        idpId: idp.id,
        ipHash: ipAddress ? this.hashPii(ipAddress) : undefined,
        uaHash: userAgent ? this.hashPii(userAgent) : undefined,
      },
      undefined,
    );

    const tokens = await this.tokenService.generateAuthResponse(user, {}, ipAddress, userAgent);
    return { user, tokens };
  }

  /** JIT provisioning: create the user inside the IdP's organization with a default role. */
  private async provisionUser(idp: IdentityProvider, socialUser: SocialUser): Promise<User> {
    const role = await this.resolveDefaultRole(idp);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const security = queryRunner.manager.create(UserSecurity, {
        passwordHash: null, // SSO users have no local password.
        failedLoginAttempts: 0,
        lockoutUntil: null,
      });

      const user = queryRunner.manager.create(User, {
        firstName: socialUser.firstName || socialUser.email.split('@')[0],
        lastName: socialUser.lastName || '',
        email: socialUser.email,
        authProvider: 'sso',
        authProviderId: socialUser.providerId,
        avatarUrl: socialUser.picture,
        isEmailVerified: true,
        organizationId: idp.organizationId,
        roles: [role],
        status: UserStatus.ACTIVE,
        security,
      });
      await queryRunner.manager.save(user);
      await queryRunner.commitTransaction();

      // Reload through the auth path so org/roles/security relations are populated for token issuance.
      const fullUser = await this.usersService.findUserForAuth(socialUser.email);
      if (!fullUser) {
        throw new BadRequestError('AUTH.FAILED_LOAD_NEWLY_PROVISIONED_USER');
      }
      this.logger.log(`JIT-provisioned SSO user ${this.hashPii(socialUser.email)} in org ${idp.organizationId}`);
      return fullUser;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private async resolveDefaultRole(idp: IdentityProvider): Promise<Role> {
    if (idp.defaultRoleId) {
      const role = await this.roleRepository.findOne({
        where: { id: idp.defaultRoleId, organizationId: idp.organizationId },
      });
      if (role) return role;
      this.logger.warn(`IdP ${idp.id} defaultRoleId not found; falling back to a member role.`);
    }
    // Fall back to a non-admin role in the org, preferring the least-privileged one.
    const roles = await this.roleRepository.find({ where: { organizationId: idp.organizationId } });
    if (!roles.length) {
      throw new BadRequestError('AUTH.ORGANIZATION_HAS_NO_ROLES_ASSIGN_SSO_USERS');
    }
    const nonAdmin = roles.find((r) => !/admin/i.test(r.name));
    return nonAdmin ?? roles[0];
  }
}
