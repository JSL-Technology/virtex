import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { FiscalRegimeSettings } from '../entities/fiscal-regime-settings.entity';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { BadRequestError } from '../../i18n/localized.exception';
import { checkPublicHttpsEndpoint } from '../../common/net/outbound-address';

/** What a transport needs to talk to a tenant's authority or authorised agent. */
export interface TransmissionTarget {
  endpoint: string;
  statusEndpoint: string;
  soapAction: string | null;
  /** The full `Authorization` header value. Never logged, never returned by the API. */
  authorization: string;
  /** `TENANT`: the tenant's own configuration. `PROCESS`: a single-tenant deployment's environment. */
  source: 'TENANT' | 'PROCESS';
}

/** What the API shows of the configuration: everything except the secret. */
export interface TransmissionSettingsView {
  countryCode: string;
  transmissionEndpoint: string | null;
  statusEndpoint: string | null;
  soapAction: string | null;
  credentialScheme: 'BEARER' | 'BASIC' | null;
  hasCredential: boolean;
  credentialUpdatedAt: Date | null;
  configured: boolean;
}

export interface TransmissionSettingsInput {
  transmissionEndpoint?: string | null;
  statusEndpoint?: string | null;
  soapAction?: string | null;
  credentialScheme?: 'BEARER' | 'BASIC' | null;
  /** A token (BEARER), or `user:password` (BASIC). Write-only. `null` removes it. */
  credential?: string | null;
}

/**
 * Each tenant's own channel to its fiscal authority (audit 2026-11-07, FAC-EINV-04).
 *
 * The endpoint and the credential used to be environment variables (`EINVOICE_MX_ENDPOINT`,
 * `PAC_API_TOKEN`…), read once per process: every Mexican tenant of the SaaS stamped through the
 * same PAC account, which is both a legal impossibility (the CFDI is stamped for the RFC that owns
 * the account) and a confidentiality failure. Now:
 *
 *  - the configuration lives on the tenant's `fiscal_regime_settings` row;
 *  - the credential is encrypted with the application's single at-rest cipher (`CryptoUtil`) and
 *    the column is `select: false`, so only this service, asking for it by name, can read it;
 *  - the endpoint must be HTTPS on a public address — checked when saved and again, by the
 *    transport's agent, at every connection (a name can be re-pointed after it was checked);
 *  - the environment variables still work for a single-tenant deployment, but only when the
 *    operator says so explicitly (`EINVOICE_PROCESS_CREDENTIALS=allow`): in a SaaS a shared
 *    credential is the defect, not a fallback.
 */
@Injectable()
export class TransmissionConfigService {
  private readonly logger = new Logger(TransmissionConfigService.name);

  constructor(
    @InjectRepository(FiscalRegimeSettings) private readonly settings: Repository<FiscalRegimeSettings>,
    private readonly crypto: CryptoUtil,
    private readonly config: ConfigService,
  ) {}

  /** The target for a tenant's documents in a market, or `null` when it has not configured one. */
  async resolve(organizationId: string, countryCode: string, manager?: EntityManager): Promise<TransmissionTarget | null> {
    const row = await this.loadWithSecret(organizationId, countryCode, manager);
    if (row?.transmissionEndpoint && row.credentialScheme && row.credentialCiphertext) {
      const secret = this.crypto.decrypt(row.credentialCiphertext);
      return {
        endpoint: row.transmissionEndpoint,
        statusEndpoint: row.statusEndpoint || row.transmissionEndpoint,
        soapAction: row.soapAction ?? null,
        authorization: authorizationHeader(row.credentialScheme, secret),
        source: 'TENANT',
      };
    }
    return this.processTarget(countryCode);
  }

  async isConfigured(organizationId: string, countryCode: string, manager?: EntityManager): Promise<boolean> {
    return (await this.resolve(organizationId, countryCode, manager)) !== null;
  }

  async view(organizationId: string, countryCode: string): Promise<TransmissionSettingsView> {
    const row = await this.loadWithSecret(organizationId, countryCode);
    return {
      countryCode,
      transmissionEndpoint: row?.transmissionEndpoint ?? null,
      statusEndpoint: row?.statusEndpoint ?? null,
      soapAction: row?.soapAction ?? null,
      credentialScheme: row?.credentialScheme ?? null,
      hasCredential: Boolean(row?.credentialCiphertext),
      credentialUpdatedAt: row?.credentialUpdatedAt ?? null,
      configured: Boolean(row?.transmissionEndpoint && row?.credentialScheme && row?.credentialCiphertext),
    };
  }

  /**
   * Save the tenant's configuration. Fields left `undefined` keep their value; the credential is
   * replaced only when one is sent, and removed with `null`.
   */
  async save(organizationId: string, countryCode: string, input: TransmissionSettingsInput): Promise<TransmissionSettingsView> {
    for (const field of ['transmissionEndpoint', 'statusEndpoint'] as const) {
      const value = input[field];
      if (value) {
        const rejection = await checkPublicHttpsEndpoint(value);
        if (rejection) throw new BadRequestError('einvoicing.transmission.endpoint_not_allowed', { field, reason: rejection });
      }
    }
    if (input.credential && !input.credentialScheme) {
      throw new BadRequestError('einvoicing.transmission.credential_scheme_required');
    }
    if (input.credential && input.credentialScheme === 'BASIC' && !/^[^:]+:.+$/.test(input.credential)) {
      throw new BadRequestError('einvoicing.transmission.basic_credential_format');
    }

    const row =
      (await this.loadWithSecret(organizationId, countryCode)) ??
      this.settings.create({ organizationId, countryCode });
    if (input.transmissionEndpoint !== undefined) row.transmissionEndpoint = input.transmissionEndpoint || null;
    if (input.statusEndpoint !== undefined) row.statusEndpoint = input.statusEndpoint || null;
    if (input.soapAction !== undefined) row.soapAction = input.soapAction?.trim() || null;
    if (input.credentialScheme !== undefined) row.credentialScheme = input.credentialScheme;
    if (input.credential !== undefined) {
      row.credentialCiphertext = input.credential ? this.crypto.encrypt(input.credential) : null;
      row.credentialUpdatedAt = new Date();
      if (!input.credential) row.credentialScheme = null;
    }
    await this.settings.save(row);
    this.logger.log(`Fiscal transmission settings updated for organization ${organizationId} (${countryCode}).`);
    return this.view(organizationId, countryCode);
  }

  private loadWithSecret(organizationId: string, countryCode: string, manager?: EntityManager): Promise<FiscalRegimeSettings | null> {
    const repository = manager ? manager.getRepository(FiscalRegimeSettings) : this.settings;
    return repository
      .createQueryBuilder('settings')
      .addSelect('settings.credentialCiphertext')
      .where('settings.organizationId = :organizationId', { organizationId })
      .andWhere('settings.countryCode = :countryCode', { countryCode: countryCode.toUpperCase() })
      .getOne();
  }

  /** The legacy, process-wide configuration — only for a deployment that opts in. */
  private processTarget(countryCode: string): TransmissionTarget | null {
    if (this.config.get<string>('EINVOICE_PROCESS_CREDENTIALS') !== 'allow') return null;
    const code = countryCode.toUpperCase();
    const prefix = code === 'MX' ? 'PAC' : `EINVOICE_${code}`;
    const endpoint = this.config.get<string>(code === 'MX' ? 'PAC_STAMP_URL' : `${prefix}_ENDPOINT`);
    const token = this.config.get<string>(code === 'MX' ? 'PAC_API_TOKEN' : `${prefix}_TOKEN`);
    const user = this.config.get<string>(`${prefix}_USERNAME`);
    const password = this.config.get<string>(`${prefix}_PASSWORD`);
    if (!endpoint || !(token || (user && password))) return null;
    return {
      endpoint,
      statusEndpoint: this.config.get<string>(`${prefix}_STATUS_ENDPOINT`) || endpoint,
      soapAction: this.config.get<string>(`${prefix}_SOAP_ACTION`) ?? null,
      authorization: token ? authorizationHeader('BEARER', token) : authorizationHeader('BASIC', `${user}:${password}`),
      source: 'PROCESS',
    };
  }
}

function authorizationHeader(scheme: 'BEARER' | 'BASIC', secret: string): string {
  return scheme === 'BEARER' ? `Bearer ${secret}` : `Basic ${Buffer.from(secret, 'utf8').toString('base64')}`;
}
