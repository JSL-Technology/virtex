import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as dns } from 'dns';
import * as crypto from 'crypto';

import { IdentityProvider } from '../entities/identity-provider.entity';
import { OrganizationDomain } from '../../organizations/entities/organization-domain.entity';
import { SecretEncryptionService } from './secret-encryption.service';
import { CreateIdentityProviderDto, UpdateIdentityProviderDto } from '../dto/sso-admin.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';

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

  async createProvider(organizationId: string, dto: CreateIdentityProviderDto): Promise<IdentityProviderView> {
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
  ): Promise<IdentityProviderView> {
    const idp = await this.getOwnedProvider(organizationId, id);

    if (dto.enabled === true) {
      // Cannot enable an IdP unless the org has at least one verified domain.
      const verifiedCount = await this.domainRepository.count({
        where: { organizationId, verified: true },
      });
      if (verifiedCount === 0) {
        throw new BadRequestError('AUTH.VERIFY_AT_LEAST_ONE_DOMAIN_BEFORE_ENABLING');
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
    if (!idp) throw new NotFoundError('AUTH.IDENTITY_PROVIDER_NOT_FOUND');
    return idp;
  }

  // --- Domains --------------------------------------------------------------

  async listDomains(organizationId: string) {
    const domains = await this.domainRepository.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
    return domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      verified: d.verified,
      verifiedAt: d.verifiedAt,
      // Tell the admin exactly what DNS record to create.
      dnsRecord: { host: `${DNS_VERIFICATION_PREFIX}.${d.domain}`, type: 'TXT', value: d.verificationToken },
    }));
  }

  async addDomain(organizationId: string, rawDomain: string) {
    const domain = rawDomain.trim().toLowerCase();
    const existing = await this.domainRepository.findOne({ where: { domain } });
    if (existing) {
      // Unique across all orgs — prevents two tenants claiming the same domain.
      throw new ConflictError('AUTH.THIS_DOMAIN_ALREADY_REGISTERED');
    }
    const created = this.domainRepository.create({
      organizationId,
      domain,
      verified: false,
      verificationToken: `virteex-sso-verification=${crypto.randomBytes(24).toString('hex')}`,
    });
    const saved = await this.domainRepository.save(created);
    return {
      id: saved.id,
      domain: saved.domain,
      verified: saved.verified,
      dnsRecord: { host: `${DNS_VERIFICATION_PREFIX}.${saved.domain}`, type: 'TXT', value: saved.verificationToken },
    };
  }

  async deleteDomain(organizationId: string, id: string): Promise<void> {
    const domain = await this.domainRepository.findOne({ where: { id, organizationId } });
    if (!domain) throw new NotFoundError('AUTH.DOMAIN_NOT_FOUND');
    await this.domainRepository.remove(domain);
  }

  /**
   * Verify domain ownership by looking up the TXT record at `_virteex-sso.<domain>` and
   * matching the issued token. This is the anti-takeover control that gates enabling SSO.
   */
  async verifyDomain(organizationId: string, id: string) {
    const domain = await this.domainRepository.findOne({ where: { id, organizationId } });
    if (!domain) throw new NotFoundError('AUTH.DOMAIN_NOT_FOUND');
    if (domain.verified) return { verified: true };

    const host = `${DNS_VERIFICATION_PREFIX}.${domain.domain}`;
    let records: string[][] = [];
    try {
      records = await dns.resolveTxt(host);
    } catch (err) {
      this.logger.warn(`DNS TXT lookup failed for ${host}: ${(err as Error)?.message}`);
      throw new BadRequestError('AUTH.NO_TXT_RECORD_FOUND_AT_ADD_IT', { host });
    }

    const flattened = records.map((chunks) => chunks.join(''));
    const matches = flattened.some((value) => value.trim() === domain.verificationToken);
    if (!matches) {
      throw new BadRequestError('AUTH.TXT_RECORD_FOUND_BUT_VALUE_DOES_NOT');
    }

    domain.verified = true;
    domain.verifiedAt = new Date();
    await this.domainRepository.save(domain);
    this.logger.log(`Domain ${domain.domain} verified for org ${organizationId}`);
    return { verified: true };
  }
}
