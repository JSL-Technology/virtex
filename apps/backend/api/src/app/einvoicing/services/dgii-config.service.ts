import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DgiiEndpoints, DgiiEnvironment, resolveDgiiEndpoints } from '../config/dgii-endpoints';
import { FiscalEnvironment, FiscalRegimeSettings } from '../entities/fiscal-regime-settings.entity';
import { isDevLikeEnvironment } from '../../config/environment';
import { assertExternalEffectAllowed, ExternalEffect } from '../../config/external-effects';

const DGII_ENVIRONMENTS: readonly DgiiEnvironment[] = ['TesteCF', 'CerteCF', 'Produccion'];

/**
 * Which DGII e-CF environment a tenant transmits to, and its endpoints (audit 2026-10-31, EINV-04).
 *
 * The environment was one per process, from `DGII_ECF_ENVIRONMENT`, CerteCF when unset. A SaaS has
 * tenants in certification and tenants in production at the same time, so one value was wrong for
 * one of them — and a production deployment that forgot the variable sent every tenant's e-CF to
 * CerteCF, where they have no fiscal validity.
 *
 * It is now the tenant's own `fiscal_regime_settings.environment` for DO: PRODUCTION → Produccion,
 * CERTIFICATION → CerteCF. The process variable keeps two narrower roles:
 *
 *  - in a development-like process (`isDevLikeEnvironment`: an unset or misspelled NODE_ENV is NOT
 *    one) it overrides every tenant, so development can point at TesteCF;
 *  - anywhere else it is only the default for a tenant that has never saved its settings, which is
 *    what deployments that set it relied on. Saving the settings takes precedence.
 */
@Injectable()
export class DgiiConfigService {
  private readonly logger = new Logger(DgiiConfigService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(FiscalRegimeSettings)
    private readonly settings: Repository<FiscalRegimeSettings>,
  ) {}

  async environmentFor(organizationId: string): Promise<DgiiEnvironment> {
    const processValue = this.processEnvironment();
    if (processValue && isDevLikeEnvironment()) return processValue;

    const row = await this.settings.findOne({
      where: { organizationId, countryCode: 'DO' },
      select: ['id', 'environment'],
    });
    if (row) return row.environment === FiscalEnvironment.PRODUCTION ? 'Produccion' : 'CerteCF';
    return processValue ?? 'CerteCF';
  }

  async endpointsFor(organizationId: string): Promise<DgiiEndpoints> {
    return resolveDgiiEndpoints(await this.environmentFor(organizationId), {
      baseUrl: this.config.get<string>('DGII_ECF_BASE_URL') || undefined,
      seed: this.config.get<string>('DGII_ECF_SEED_URL') || undefined,
      validateSeed: this.config.get<string>('DGII_ECF_VALIDATE_SEED_URL') || undefined,
      reception: this.config.get<string>('DGII_ECF_RECEPTION_URL') || undefined,
      status: this.config.get<string>('DGII_ECF_STATUS_URL') || undefined,
      trackIds: this.config.get<string>('DGII_ECF_TRACKIDS_URL') || undefined,
      commercialApproval: this.config.get<string>('DGII_ECF_APPROVAL_URL') || undefined,
    });
  }

  /**
   * The endpoints for a call that REACHES the DGII. Refused when this process may not talk to a
   * fiscal authority (config/external-effects.ts). `endpointsFor` stays unguarded because it also
   * builds the timbre URL printed on the document, which sends nothing.
   */
  async transmissionEndpointsFor(organizationId: string): Promise<DgiiEndpoints> {
    assertExternalEffectAllowed(ExternalEffect.FiscalAuthority);
    return this.endpointsFor(organizationId);
  }

  get httpTimeoutMs(): number {
    const raw = Number(this.config.get<string>('DGII_ECF_HTTP_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : 30000;
  }

  private processEnvironment(): DgiiEnvironment | null {
    const raw = (this.config.get<string>('DGII_ECF_ENVIRONMENT') ?? '').trim();
    if (!raw) return null;
    if ((DGII_ENVIRONMENTS as readonly string[]).includes(raw)) return raw as DgiiEnvironment;
    this.logger.warn(`DGII_ECF_ENVIRONMENT="${raw}" is not one of ${DGII_ENVIRONMENTS.join(', ')}; ignored.`);
    return null;
  }
}
