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

export interface DgiiTrackIdEntry {
  trackId: string;
  estado?: string;
  fecha?: string;
}

/**
 * Transmits signed e-CF to the DGII and polls the resulting verdict.
 *
 * ## The routing rule that was missing
 *
 * Every document went to `endpoints.reception`. The DGII operates a SEPARATE service for consumo
 * comprobantes below its threshold — "Recepción de Factura de Consumo", which takes a summary — so
 * sending an E32 to the ordinary reception service is rejected on arrival. `sendEcf` now routes by
 * document type, and the caller does not have to know the rule.
 *
 * All calls carry the bearer token obtained from {@link DgiiAuthService}. Network and HTTP failures
 * surface as `ServiceUnavailableException` so the orchestrator can fall back to contingency and
 * retry, rather than marking a document permanently failed because a socket timed out.
 */
@Injectable()
export class DgiiTransportService {
  private readonly logger = new Logger(DgiiTransportService.name);

  /** DGII document types routed through the consumo summary service. */
  private static readonly CONSUMO_TYPES = new Set(['32']);

  constructor(private readonly config: DgiiConfigService) {}

  /**
   * Submit a signed e-CF and return the DGII trackId.
   *
   * @param ecfType DGII document type (`31`, `32`, …). Decides which reception service is used.
   */
  async sendEcf(
    token: string,
    signedXml: string,
    eNcf: string,
    ecfType: string,
  ): Promise<DgiiReceptionResult> {
    const endpoint = DgiiTransportService.CONSUMO_TYPES.has(ecfType)
      ? this.config.endpoints.receptionConsumo
      : this.config.endpoints.reception;

    const form = new FormData();
    form.append('xml', Buffer.from(signedXml, 'utf8'), {
      filename: `${eNcf}.xml`,
      contentType: 'application/xml',
    });

    try {
      const { data } = await axios.post(endpoint, form, {
        timeout: this.config.httpTimeoutMs,
        headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
        maxBodyLength: Infinity,
      });
      return {
        trackId: data?.trackId ?? data?.TrackId ?? data?.trackID,
        estado: data?.estado ?? data?.Estado,
        mensajes: this.extractMessages(data),
        raw: data,
      };
    } catch (err) {
      // A 4xx from the DGII is a verdict about the document, not an outage: surface it as such so
      // the orchestrator records a rejection instead of retrying a document that will never pass.
      const ax = err as AxiosError;
      const status = ax?.response?.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        return {
          estado: 'Rechazado',
          mensajes: this.extractMessages(ax.response?.data) ?? [],
          raw: ax.response?.data ?? { status },
        };
      }
      throw this.transportError('transmitir el e-CF', err);
    }
  }

  /** Poll the final verdict for a trackId. */
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

  /**
   * TrackIds already registered for an e-NCF.
   *
   * This is the idempotency check: before re-transmitting a document after a timeout, ask whether
   * the DGII already has it. Without it a retry can submit the same comprobante twice, and the
   * endpoint was resolved in configuration but never called.
   */
  async queryTrackIds(token: string, rncEmisor: string, eNcf: string): Promise<DgiiTrackIdEntry[]> {
    try {
      const { data } = await axios.get(this.config.endpoints.trackIds, {
        timeout: this.config.httpTimeoutMs,
        params: { RNC: rncEmisor, ENCF: eNcf },
        headers: { Authorization: `Bearer ${token}` },
      });
      const rows = Array.isArray(data) ? data : (data?.trackIds ?? data?.TrackIds ?? []);
      if (!Array.isArray(rows)) return [];
      return rows
        .map((row: Record<string, unknown>) => ({
          trackId: String(row?.['trackId'] ?? row?.['TrackId'] ?? ''),
          estado: (row?.['estado'] ?? row?.['Estado']) as string | undefined,
          fecha: (row?.['fechaRecepcion'] ?? row?.['FechaRecepcion']) as string | undefined,
        }))
        .filter((row) => row.trackId);
    } catch (err) {
      throw this.transportError('consultar los trackIds del e-NCF', err);
    }
  }

  /**
   * Send a commercial approval or rejection for a comprobante received from a supplier.
   *
   * Part of the e-CF cycle a receiver is required to complete: the endpoint was configured and
   * never invoked, so a tenant could neither accept nor dispute what its suppliers issued to it.
   */
  async sendCommercialApproval(token: string, signedXml: string, eNcf: string): Promise<DgiiReceptionResult> {
    const form = new FormData();
    form.append('xml', Buffer.from(signedXml, 'utf8'), {
      filename: `AC_${eNcf}.xml`,
      contentType: 'application/xml',
    });

    try {
      const { data } = await axios.post(this.config.endpoints.commercialApproval, form, {
        timeout: this.config.httpTimeoutMs,
        headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
      });
      return {
        trackId: data?.trackId ?? data?.TrackId,
        estado: data?.estado ?? data?.Estado,
        mensajes: this.extractMessages(data),
        raw: data,
      };
    } catch (err) {
      throw this.transportError('enviar la aprobación comercial', err);
    }
  }

  /**
   * Declare a stretch of an authorized range as annulled.
   *
   * A fiscal number that was assigned and will never be used has to be declared, or the DGII sees a
   * gap in the taxpayer's sequence. There was no way to do this at all.
   */
  async voidSequenceRange(token: string, signedXml: string): Promise<DgiiReceptionResult> {
    const form = new FormData();
    form.append('xml', Buffer.from(signedXml, 'utf8'), {
      filename: 'anulacion.xml',
      contentType: 'application/xml',
    });

    try {
      const { data } = await axios.post(this.config.endpoints.voidRange, form, {
        timeout: this.config.httpTimeoutMs,
        headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
      });
      return {
        trackId: data?.trackId ?? data?.TrackId,
        estado: data?.estado ?? data?.Estado,
        mensajes: this.extractMessages(data),
        raw: data,
      };
    } catch (err) {
      throw this.transportError('anular el rango de e-NCF', err);
    }
  }

  private extractMessages(data: unknown): string[] {
    const raw =
      (data as { mensajes?: unknown })?.mensajes ?? (data as { Mensajes?: unknown })?.Mensajes;
    if (!Array.isArray(raw)) {
      const single = (data as { mensaje?: string })?.mensaje;
      return single ? [single] : [];
    }
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
    const detail = ax?.response
      ? `HTTP ${ax.response.status}`
      : ax?.code || (err as Error)?.message || 'error';
    this.logger.error(`Fallo al ${action} ante la DGII: ${detail}`);
    return new ServiceUnavailableException(`No se pudo ${action} ante la DGII (${detail}).`);
  }
}
