import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, QueryFailedError, Repository } from 'typeorm';
import { promises as dns } from 'dns';
import * as crypto from 'crypto';
import { IdentityProvider } from '../entities/identity-provider.entity';
import { OrganizationDomain } from '../../organizations/entities/organization-domain.entity';
import { SecretEncryptionService } from './secret-encryption.service';
import { CreateIdentityProviderDto, UpdateIdentityProviderDto } from '../dto/sso-admin.dto';
import { AuthenticatedUser } from '../../security/principal';
import { RoleDelegationPort } from '../ports/role-delegation.port';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';

/**
 * How long a pending claim may wait for its DNS record. After that it is discarded: an unproven
 * claim holds nothing for anyone, and leaving it forever only clutters the owner's list.
 */
export const PENDING_DOMAIN_CLAIM_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// DNS host (relative to the domain) where the org must publish the verification TXT record.
const DNS_VERIFICATION_PREFIX = '_virteex-sso';

/** API-safe view of an IdP — never includes the (encrypted) client secret. */
export interface IdentityProviderView {
  id: string;
  name: string;
  type: string;
  issuerUrl: string;
  clientId: string;
  scopes: string[];
  defaultRoleId: string | null;
  enabled: boolean;
  redirectUri: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SsoAdminService {
  private readonly logger = new Logger(SsoAdminService.name);

  constructor(
    @InjectRepository(IdentityProvider)
    private readonly idpRepository: Repository<IdentityProvider>,
    @InjectRepository(OrganizationDomain)
    private readonly domainRepository: Repository<OrganizationDomain>,
    private readonly secretEncryption: SecretEncryptionService,
    private readonly configService: ConfigService,
    // The narrow port, so `auth` asks `roles` its one question without importing the module.
    private readonly roleDelegation: RoleDelegationPort,
  ) {}

  private redirectUriFor(idpId: string): string {
    const apiBase = this.configService.get<string>('API_PUBLIC_URL', 'http://localhost:3000/api/v1');
    return `${apiBase.replace(/\/$/, '')}/auth/sso/${idpId}/callback`;
  }

  private toView(idp: IdentityProvider): IdentityProviderView {
    return {
      id: idp.id,
      name: idp.name,
      type: idp.type,
      issuerUrl: idp.issuerUrl,
      clientId: idp.clientId,
      scopes: idp.scopes,
      defaultRoleId: idp.defaultRoleId,
      enabled: idp.enabled,
      redirectUri: this.redirectUriFor(idp.id),
      createdAt: idp.createdAt,
      updatedAt: idp.updatedAt,
    };
  }

  // --- Identity providers ---------------------------------------------------

  async listProviders(organizationId: string): Promise<IdentityProviderView[]> {
    const idps = await this.idpRepository.find({ where: { organizationId }, order: { createdAt: 'DESC' } });
    return idps.map((i) => this.toView(i));
  }

  /**
   * The check that was missing on the third place a role is assigned.
   *
   * This product has one rule about handing out rights, and it is well implemented: nobody
   * delegates a permission they do not themselves hold (`RolesService.assertCanAssignRole`). It is
   * applied in `UsersService.updateUser` and `UsersService.inviteUser`, and the comment on the
   * latter states those are "the only other two places a role is assigned".
   *
   * They were not. `IdentityProvider.defaultRoleId` is a third: every user JIT-provisioned through
   * this IdP is created with that role (`EnterpriseSsoService.provisionUser`). It was accepted
   * straight from the request body, behind `settings:edit_company` — a configuration permission
   * that implies nothing about managing users. Someone holding only that could point the IdP at
   * the ADMINISTRATOR role and every new account from their verified domain would be created with
   * `'*'`.
   *
   * Assigning a role through an IdP is assigning a role. Same rule, same check.
   */
  private async assertRoleIsDelegable(
    actor: AuthenticatedUser,
    organizationId: string,
    roleId: string,
  ): Promise<void> {
    // Scoped to the tenant, so an id from another organization cannot be pointed at.
    await this.roleDelegation.assertCanAssignRoleById(actor, roleId, organizationId);
  }

  async createProvider(
    organizationId: string,
    dto: CreateIdentityProviderDto,
    actor: AuthenticatedUser,
  ): Promise<IdentityProviderView> {
    if (dto.defaultRoleId) {
      await this.assertRoleIsDelegable(actor, organizationId, dto.defaultRoleId);
    }

    const idp = this.idpRepository.create({
      organizationId,
      name: dto.name,
      issuerUrl: dto.issuerUrl,
      clientId: dto.clientId,
      clientSecretEncrypted: this.secretEncryption.encrypt(dto.clientSecret),
      scopes: dto.scopes?.length ? dto.scopes : ['openid', 'email', 'profile'],
      defaultRoleId: dto.defaultRoleId ?? null,
      enabled: false, // must verify a domain and explicitly enable
    });
    const saved = await this.idpRepository.save(idp);
    return this.toView(saved);
  }

  async updateProvider(
    organizationId: string,
    id: string,
    dto: UpdateIdentityProviderDto,
    actor: AuthenticatedUser,
  ): Promise<IdentityProviderView> {
    const idp = await this.getOwnedProvider(organizationId, id);

    if (dto.defaultRoleId) {
      await this.assertRoleIsDelegable(actor, organizationId, dto.defaultRoleId);
    }

    if (dto.enabled === true) {
      // Cannot enable an IdP unless the org has at least one verified domain.
      const verifiedCount = await this.domainRepository.count({
        where: { organizationId, verified: true },
      });
      if (verifiedCount === 0) {
        throw new BadRequestError('auth.verify_at_least_one_domain_before_enabling');
      }
    }

    if (dto.name !== undefined) idp.name = dto.name;
    if (dto.issuerUrl !== undefined) idp.issuerUrl = dto.issuerUrl;
    if (dto.clientId !== undefined) idp.clientId = dto.clientId;
    if (dto.clientSecret) idp.clientSecretEncrypted = this.secretEncryption.encrypt(dto.clientSecret);
    if (dto.scopes !== undefined) idp.scopes = dto.scopes;
    if (dto.defaultRoleId !== undefined) idp.defaultRoleId = dto.defaultRoleId ?? null;
    if (dto.enabled !== undefined) idp.enabled = dto.enabled;

    const saved = await this.idpRepository.save(idp);
    return this.toView(saved);
  }

  async deleteProvider(organizationId: string, id: string): Promise<void> {
    const idp = await this.getOwnedProvider(organizationId, id);
    await this.idpRepository.remove(idp);
  }

  private async getOwnedProvider(organizationId: string, id: string): Promise<IdentityProvider> {
    const idp = await this.idpRepository.findOne({ where: { id, organizationId } });
    if (!idp) throw new NotFoundError('auth.identity_provider_not_found');
    return idp;
  }

  // --- Domains --------------------------------------------------------------

  async listDomains(organizationId: string) {
    await this.discardExpiredClaims(organizationId);
    // tenant-scope-guard-allow: filtered by `organizationId` — the `sso_routing` policy would
    // otherwise also return every other tenant's verified claims.
    const domains = await this.domainRepository.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
    return domains.map((d) => this.describe(d));
  }

  /**
   * Claim a domain for this organization.
   *
   * The answer is the same whoever else holds a claim on it: a pending claim of this
   * organization and the DNS record that would prove it. It used to be refused as "already
   * registered" when ANY tenant had claimed it, verified or not — so an unproven claim blocked
   * the real owner for good, and the refusal told a stranger the domain was in use. Whether it can
   * be verified is settled by DNS, at verification.
   */
  async addDomain(organizationId: string, rawDomain: string) {
    const domain = rawDomain.trim().toLowerCase().replace(/\.$/, '');
    await this.discardExpiredClaims(organizationId);

    // tenant-scope-guard-allow: filtered by `organizationId`.
    const own = await this.domainRepository.findOne({ where: { domain, organizationId } });
    if (own) return this.describe(own);

    const created = this.domainRepository.create({
      organizationId,
      domain,
      verified: false,
      verificationToken: `virteex-sso-verification=${crypto.randomBytes(24).toString('hex')}`,
    });
    return this.describe(await this.domainRepository.save(created));
  }

  async deleteDomain(organizationId: string, id: string): Promise<void> {
    const domain = await this.domainRepository.findOne({ where: { id, organizationId } });
    if (!domain) throw new NotFoundError('auth.domain_not_found');
    await this.domainRepository.remove(domain);
  }

  /** What the administrator is shown for one claim, including the record to publish. */
  private describe(d: OrganizationDomain) {
    return {
      id: d.id,
      domain: d.domain,
      verified: d.verified,
      verifiedAt: d.verifiedAt ?? null,
      // When a pending claim will be discarded if its record has not been found by then.
      expiresAt: d.verified ? null : new Date(d.createdAt.getTime() + PENDING_DOMAIN_CLAIM_TTL_MS),
      // Tell the admin exactly what DNS record to create.
      dnsRecord: { host: `${DNS_VERIFICATION_PREFIX}.${d.domain}`, type: 'TXT', value: d.verificationToken },
    };
  }

  /** Discard this organization's pending claims that outlived their window. */
  private async discardExpiredClaims(organizationId: string): Promise<void> {
    const cutoff = new Date(Date.now() - PENDING_DOMAIN_CLAIM_TTL_MS);
    await this.domainRepository.delete({
      organizationId,
      verified: false,
      createdAt: LessThan(cutoff),
    });
  }

  /**
   * Verify domain ownership by looking up the TXT record at `_virteex-sso.<domain>` and
   * matching the issued token. This is the anti-takeover control that gates enabling SSO.
   */
  async verifyDomain(organizationId: string, id: string) {
    await this.discardExpiredClaims(organizationId);
    const domain = await this.domainRepository.findOne({ where: { id, organizationId } });
    if (!domain) throw new NotFoundError('auth.domain_not_found');
    if (domain.verified) return { verified: true };

    const host = `${DNS_VERIFICATION_PREFIX}.${domain.domain}`;
    let records: string[][] = [];
    try {
      records = await dns.resolveTxt(host);
    } catch (err) {
      this.logger.warn(`DNS TXT lookup failed for ${host}: ${(err as Error)?.message}`);
      throw new BadRequestError('auth.no_txt_record_found_at_add_it', { host });
    }

    const flattened = records.map((chunks) => chunks.join(''));
    const matches = flattened.some((value) => value.trim() === domain.verificationToken);
    if (!matches) {
      throw new BadRequestError('auth.txt_record_found_but_value_does_not');
    }

    // Proven. It can still be refused: another organization may hold it verified already. Saying
    // so is fine here — only whoever controls the domain's DNS can get this far.
    // tenant-scope-guard-allow: the one cross-tenant question verification must ask, answered
    // from verified claims only (`sso_routing`).
    const taken = await this.domainRepository.findOne({
      where: { domain: domain.domain, verified: true },
    });
    if (taken && taken.organizationId !== organizationId) {
      throw new ConflictError('auth.domain_verified_by_another_organization');
    }

    domain.verified = true;
    domain.verifiedAt = new Date();
    domain.lastCheckedAt = new Date();
    domain.failedChecks = 0;
    try {
      await this.domainRepository.save(domain);
    } catch (error) {
      // Two organizations proving the same domain at once: the partial unique index lets one win.
      if (error instanceof QueryFailedError && (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505') {
        throw new ConflictError('auth.domain_verified_by_another_organization');
      }
      throw error;
    }
    this.logger.log(`Domain ${domain.domain} verified for org ${organizationId}`);
    return { verified: true };
  }
}
