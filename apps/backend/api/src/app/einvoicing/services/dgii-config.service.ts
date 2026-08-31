import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DgiiEndpoints, DgiiEnvironment, resolveDgiiEndpoints } from '../config/dgii-endpoints';

/**
 * Resolves the DGII e-CF runtime configuration from environment/config. Everything the transport
 * needs — which environment, the (optionally overridden) endpoints, and network timeouts — comes
 * from here so no host or path is hardcoded at the call sites.
 */
@Injectable()
export class DgiiConfigService {
  constructor(private readonly config: ConfigService) {}

  get environment(): DgiiEnvironment {
    const raw = (this.config.get<string>('DGII_ECF_ENVIRONMENT') || 'CerteCF').trim();
    if (raw === 'TesteCF' || raw === 'CerteCF' || raw === 'Produccion') return raw;
    return 'CerteCF';
  }

  get endpoints(): DgiiEndpoints {
    return resolveDgiiEndpoints(this.environment, {
      baseUrl: this.config.get<string>('DGII_ECF_BASE_URL') || undefined,
      seed: this.config.get<string>('DGII_ECF_SEED_URL') || undefined,
      validateSeed: this.config.get<string>('DGII_ECF_VALIDATE_SEED_URL') || undefined,
      reception: this.config.get<string>('DGII_ECF_RECEPTION_URL') || undefined,
      status: this.config.get<string>('DGII_ECF_STATUS_URL') || undefined,
      trackIds: this.config.get<string>('DGII_ECF_TRACKIDS_URL') || undefined,
      commercialApproval: this.config.get<string>('DGII_ECF_APPROVAL_URL') || undefined,
    });
  }

  get httpTimeoutMs(): number {
    const raw = Number(this.config.get<string>('DGII_ECF_HTTP_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : 30000;
  }
}
