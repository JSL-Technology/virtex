import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import { DgiiConfigService } from './dgii-config.service';
import { EcfSignerService } from './ecf-signer.service';
import type { LoadedCertificate } from './certificate-vault.service';

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

/**
 * DGII authentication: the "semilla" handshake.
 *
 *   1. GET a seed (an XML `SemillaModel`) from the DGII.
 *   2. Sign that seed with the tenant's certificate (enveloped XMLDSig).
 *   3. POST the signed seed to `ValidarSemilla`; the DGII returns a bearer token with an expiry.
 *
 * Tokens are cached per (organization, environment) and reused until shortly before they expire, so
 * a burst of e-CF submissions performs one handshake, not one per document.
 */
@Injectable()
export class DgiiAuthService {
  private readonly logger = new Logger(DgiiAuthService.name);
  private readonly cache = new Map<string, CachedToken>();
  /** Refresh this many ms before the real expiry to avoid using a token mid-flight. */
  private static readonly EXPIRY_SKEW_MS = 60_000;

  constructor(
    private readonly config: DgiiConfigService,
    private readonly signer: EcfSignerService,
  ) {}

  private cacheKey(organizationId: string): string {
    return `${organizationId}:${this.config.environment}`;
  }

  async getToken(organizationId: string, cert: LoadedCertificate, force = false): Promise<string> {
    const key = this.cacheKey(organizationId);
    const cached = this.cache.get(key);
    if (!force && cached && cached.expiresAt - DgiiAuthService.EXPIRY_SKEW_MS > this.now()) {
      return cached.token;
    }

    const seedXml = await this.fetchSeed();
    const signedSeed = this.signer.sign(seedXml, cert, 'SemillaModel');
    const { token, expiresAt } = await this.validateSeed(signedSeed);

    this.cache.set(key, { token, expiresAt });
    return token;
  }

  /** Drops any cached token, forcing a fresh handshake on the next call. */
  invalidate(organizationId: string): void {
    this.cache.delete(this.cacheKey(organizationId));
  }

  private now(): number {
    return Date.now();
  }

  private async fetchSeed(): Promise<string> {
    try {
      const { data } = await axios.get(this.config.endpoints.seed, {
        timeout: this.config.httpTimeoutMs,
        responseType: 'text',
        headers: { Accept: 'application/xml' },
      });
      if (typeof data !== 'string' || !data.includes('SemillaModel')) {
        // The seed can also arrive wrapped; accept any XML that carries a valor/fecha pair.
        if (typeof data !== 'string' || !data.trim().startsWith('<')) {
          throw new Error('La DGII no devolvió una semilla XML válida.');
        }
      }
      return data;
    } catch (err) {
      throw this.transportError('obtener la semilla de autenticación', err);
    }
  }

  private async validateSeed(signedSeedXml: string): Promise<{ token: string; expiresAt: number }> {
    const form = new FormData();
    form.append('xml', Buffer.from(signedSeedXml, 'utf8'), {
      filename: 'semilla.xml',
      contentType: 'application/xml',
    });

    try {
      const { data } = await axios.post(this.config.endpoints.validateSeed, form, {
        timeout: this.config.httpTimeoutMs,
        headers: form.getHeaders(),
      });

      const token: string | undefined = data?.token ?? data?.Token;
      const expiraRaw: string | undefined = data?.expira ?? data?.Expira ?? data?.expiration;
      if (!token) {
        throw new Error('La respuesta de ValidarSemilla no incluyó un token.');
      }
      const parsedExpiry = expiraRaw ? Date.parse(expiraRaw) : NaN;
      const expiresAt = Number.isFinite(parsedExpiry) ? parsedExpiry : this.now() + 30 * 60_000;
      return { token, expiresAt };
    } catch (err) {
      throw this.transportError('validar la semilla firmada', err);
    }
  }

  private transportError(action: string, err: unknown): ServiceUnavailableException {
    const ax = err as AxiosError;
    const detail = ax?.response
      ? `HTTP ${ax.response.status}`
      : ax?.code || (err as Error)?.message || 'error desconocido';
    this.logger.error(`Fallo al ${action} ante la DGII: ${detail}`);
    return new ServiceUnavailableException(`No se pudo ${action} ante la DGII (${detail}).`);
  }
}
