import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DgiiEndpoints, DgiiEnvironment, resolveDgiiEndpoints } from './dgii-endpoints';
import { FiscalEnvironment, FiscalRegimeSettings } from '../../entities/fiscal-regime-settings.entity';
import { isDevLikeEnvironment } from '../../../config/environment';
import { assertExternalEffectAllowed, ExternalEffect } from '../../../config/external-effects';

const ENVIRONMENTS: readonly DgiiEnvironment[] = ['TesteCF', 'CerteCF', 'Produccion'];

/**
 * Which DGII e-CF environment a tenant transmits to, and its endpoints (audit 2026-10-31, EINV-04).
 *
 * The environment was one per process, from `EINVOICE_DO_ENVIRONMENT`, CerteCF when unset. A SaaS has
 * tenants in certification and tenants in production at the same time, so one value was wrong for
 * one of them — and a production deployment that forgot the variable sent every tenant's e-CF to
 * CerteCF, where they have no fiscal validity.
 *
 * It is now the tenant's own `fiscal_regime_settings.environment` for DO: PRODUCTION → Produccion,
 * CERTIFICATION → CerteCF. A tenant that never saved its settings is certified first — never filed
 * for real by default.
 *
 * ## The process variables, and why they are gated like every other regime's
 *
 * `EINVOICE_DO_ENVIRONMENT` and the `EINVOICE_DO_*_URL` overrides are a DEPLOYMENT's lever, not a
 * tenant's channel: a Dominican tenant's channel is its environment (its own row) and its
 * certificate, which is why this regime needs no endpoint or credential configured per tenant
 * (`DgiiRegimeAdapter.isTransmissionConfigured`). The overrides exist for the day the DGII
 * republishes a host or a path, so a deployment need not wait for a release.
 *
 * They therefore follow the one rule the product already applies to every other regime's
 * process-wide channel (`TransmissionConfigService`): a development-like process may use them
 * (`isDevLikeEnvironment`: an unset or misspelled NODE_ENV is NOT one), and any other process only
 * when the operator says so explicitly (`EINVOICE_PROCESS_CREDENTIALS=allow`). Set where they are
 * not allowed, they are ignored and named in a warning — an override that silently does nothing is
 * how a deployment comes to believe it is filing somewhere it is not. The DGII was the last regime
 * whose channel a process variable could decide (plan, fase 3).
 *
 * The HTTP timeout is not a channel and stays a process setting.
 */
@Injectable()
export class DgiiConfigService {
  private readonly logger = new Logger(DgiiConfigService.name);
  private warned = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(FiscalRegimeSettings)
    private readonly settings: Repository<FiscalRegimeSettings>,
  ) {}

  async environmentFor(organizationId: string): Promise<DgiiEnvironment> {
    const pinned = this.processEnvironment();
    if (pinned && isDevLikeEnvironment()) return pinned;

    const row = await this.settings.findOne({
      where: { organizationId, countryCode: 'DO' },
      select: ['id', 'environment'],
    });
    if (row) return row.environment === FiscalEnvironment.PRODUCTION ? 'Produccion' : 'CerteCF';
    // No settings of its own: certification, unless this deployment was allowed to say otherwise.
    return (this.processConfigAllowed() ? pinned : null) ?? 'CerteCF';
  }

  async endpointsFor(organizationId: string): Promise<DgiiEndpoints> {
    return resolveDgiiEndpoints(await this.environmentFor(organizationId), this.processOverrides());
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

  /** How long to wait for the authority. The shared `EINVOICE_TIMEOUT_MS`: a timeout is not a channel. */
  get httpTimeoutMs(): number {
    const raw = Number(this.config.get<string>('EINVOICE_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : 30000;
  }

  private processEnvironment(): DgiiEnvironment | null {
    const raw = (this.config.get<string>('EINVOICE_DO_ENVIRONMENT') ?? '').trim();
    if (!raw) return null;
    if ((ENVIRONMENTS as readonly string[]).includes(raw)) return raw as DgiiEnvironment;
    this.logger.warn(`EINVOICE_DO_ENVIRONMENT="${raw}" is not one of ${ENVIRONMENTS.join(', ')}; ignored.`);
    return null;
  }

  /** The endpoints this deployment pinned, where it is allowed to pin any. */
  private processOverrides(): Partial<DgiiEndpoints> & { baseUrl?: string } {
    const pinned = Object.entries(PINNED_ENDPOINTS)
      .map(([variable, field]) => [variable, field, this.processValue(variable)] as const)
      .filter(([, , value]) => value);
    if (!pinned.length) return {};
    if (!isDevLikeEnvironment() && !this.processConfigAllowed()) {
      this.warnIgnored(pinned.map(([variable]) => variable));
      return {};
    }
    return Object.fromEntries(pinned.map(([, field, value]) => [field, value]));
  }

  private processValue(variable: string): string | undefined {
    return (this.config.get<string>(variable) ?? '').trim() || undefined;
  }

  /**
   * Whether this deployment may configure a fiscal channel process-wide at all.
   *
   * The same switch as every other regime's, read here rather than redeclared: a deployment either
   * configures fiscal channels for the whole process or it does not, and having two answers to that
   * is how one regime keeps an exception nobody remembers.
   */
  private processConfigAllowed(): boolean {
    return this.config.get<string>('EINVOICE_PROCESS_CREDENTIALS') === 'allow';
  }

  private warnIgnored(variables: readonly string[]): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(
      `${variables.join(', ')} ignored: in this process a tenant's fiscal channel is its own ` +
        `environment and certificate. Set EINVOICE_PROCESS_CREDENTIALS=allow to let this ` +
        `deployment pin these endpoints for every tenant.`,
    );
  }
}

/**
 * Each variable a deployment may pin an endpoint with, and the endpoint it pins.
 *
 * Keyed by the variable's own name so that searching for it in the codebase finds the one place it
 * is read. `baseUrl` pins the host of all of them at once, which is what differs between the DGII's
 * own environments; the rest pin one service each, because the DGII versions its paths
 * independently.
 */
const PINNED_ENDPOINTS: Readonly<Record<string, string>> = {
  EINVOICE_DO_BASE_URL: 'baseUrl',
  EINVOICE_DO_SEED_URL: 'seed',
  EINVOICE_DO_VALIDATE_SEED_URL: 'validateSeed',
  EINVOICE_DO_RECEPTION_URL: 'reception',
  EINVOICE_DO_STATUS_URL: 'status',
  EINVOICE_DO_TRACKIDS_URL: 'trackIds',
  EINVOICE_DO_APPROVAL_URL: 'commercialApproval',
};
