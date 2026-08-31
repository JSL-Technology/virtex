import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import { DgiiConfigService } from './dgii-config.service';

export interface DgiiReceptionResult {
  trackId?: string;
  estado?: string;
  mensajes: string[];
  raw: unknown;
}

export interface DgiiStatusResult {
  estado: string;
  mensajes: string[];
  raw: unknown;
}

/**
 * Transmits signed e-CF to the DGII and polls the resulting verdict. All calls carry the bearer
 * token obtained from {@link DgiiAuthService}. Network/HTTP failures surface as
 * `ServiceUnavailableException` so the orchestrator can fall back to contingency and retry.
 */
@Injectable()
export class DgiiTransportService {
  private readonly logger = new Logger(DgiiTransportService.name);

  constructor(private readonly config: DgiiConfigService) {}

  /** Submits the signed e-CF to the reception endpoint; returns the DGII trackId. */
  async sendEcf(token: string, signedXml: string, eNcf: string): Promise<DgiiReceptionResult> {
    const form = new FormData();
    form.append('xml', Buffer.from(signedXml, 'utf8'), {
      filename: `${eNcf}.xml`,
      contentType: 'application/xml',
    });

    try {
      const { data } = await axios.post(this.config.endpoints.reception, form, {
        timeout: this.config.httpTimeoutMs,
        headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
      });
      return {
        trackId: data?.trackId ?? data?.TrackId ?? data?.trackID,
        estado: data?.estado ?? data?.Estado,
        mensajes: this.extractMessages(data),
        raw: data,
      };
    } catch (err) {
      throw this.transportError('transmitir el e-CF', err);
    }
  }

  /** Polls the final verdict for a trackId. */
  async queryStatus(token: string, trackId: string): Promise<DgiiStatusResult> {
    try {
      const { data } = await axios.get(this.config.endpoints.status, {
        timeout: this.config.httpTimeoutMs,
        params: { trackId },
        headers: { Authorization: `Bearer ${token}` },
      });
      return {
        estado: data?.estado ?? data?.Estado ?? 'EnProceso',
        mensajes: this.extractMessages(data),
        raw: data,
      };
    } catch (err) {
      throw this.transportError('consultar el estado del e-CF', err);
    }
  }

  private extractMessages(data: unknown): string[] {
    const raw = (data as { mensajes?: unknown; Mensajes?: unknown })?.mensajes
      ?? (data as { Mensajes?: unknown })?.Mensajes;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((m) => {
        if (typeof m === 'string') return m;
        const obj = m as { valor?: string; mensaje?: string; Mensaje?: string };
        return obj?.valor ?? obj?.mensaje ?? obj?.Mensaje ?? JSON.stringify(m);
      })
      .filter((m): m is string => Boolean(m));
  }

  private transportError(action: string, err: unknown): ServiceUnavailableException {
    const ax = err as AxiosError;
    const detail = ax?.response ? `HTTP ${ax.response.status}` : ax?.code || (err as Error)?.message || 'error';
    this.logger.error(`Fallo al ${action} ante la DGII: ${detail}`);
    return new ServiceUnavailableException(`No se pudo ${action} ante la DGII (${detail}).`);
  }
}
