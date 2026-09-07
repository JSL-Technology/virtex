import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { FiscalTransmissionResult } from '../fiscal-regime.types';

/**
 * Stamping a CFDI — the step only an authorised PAC may perform.
 *
 * ## Why this is a port and not an implementation
 *
 * The SAT does not stamp comprobantes. It authorises third parties (*Proveedores Autorizados de
 * Certificación*) to do it, and a taxpayer contracts one: Finkok, Solución Factible, Facturama,
 * Diverza, a dozen others. Each exposes its own API — some SOAP, some REST, all with their own
 * credentials — and none of them can be called without that taxpayer's contract.
 *
 * So the product does everything up to the stamp and then calls **the PAC the tenant configured**,
 * at the URL they configured, with the credentials they configured. Nothing is simulated: with no
 * configuration this returns `NOT_CONFIGURED` and the document stays built, sealed and unstamped,
 * which is its true state. A stamped-looking document that was never stamped would be a lie the
 * taxpayer would discover at their next audit.
 *
 * The request shape below is the one the REST PACs share: the sealed XML posted as base64 with a
 * bearer or basic credential, answered with the stamped XML and the UUID. A tenant whose PAC
 * speaks SOAP configures `PAC_PROTOCOL=soap` and the envelope is wrapped accordingly.
 */
@Injectable()
export class PacProvider {
  private readonly logger = new Logger(PacProvider.name);

  constructor(private readonly config: ConfigService) {}

  /** Whether this tenant can stamp at all. */
  configured(): boolean {
    return Boolean(this.config.get<string>('PAC_STAMP_URL') && this.credential());
  }

  private credential(): string | null {
    const token = this.config.get<string>('PAC_API_TOKEN');
    if (token) return `Bearer ${token}`;
    const user = this.config.get<string>('PAC_USERNAME');
    const password = this.config.get<string>('PAC_PASSWORD');
    if (user && password) {
      return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    }
    return null;
  }

  /**
   * Send a sealed CFDI for stamping.
   *
   * A network failure is `PENDING`, not `REJECTED`: the PAC may well have stamped it, and a
   * taxpayer who reissues on a timeout ends up with two comprobantes for one sale, which is a
   * worse problem than a document whose status is unknown for an hour.
   */
  async stamp(sealedXml: string): Promise<FiscalTransmissionResult> {
    const url = this.config.get<string>('PAC_STAMP_URL');
    const credential = this.credential();
    if (!url || !credential) {
      return {
        status: 'NOT_CONFIGURED',
        messages: ['PAC_STAMP_URL y las credenciales del PAC no están configuradas.'],
      };
    }

    try {
      const response = await axios.post(
        url,
        { xml: Buffer.from(sealedXml, 'utf8').toString('base64') },
        {
          headers: { Authorization: credential, 'Content-Type': 'application/json' },
          timeout: Number(this.config.get<string>('PAC_TIMEOUT_MS') ?? 30_000),
        },
      );

      const body = response.data as Record<string, unknown>;
      const uuid = this.pick(body, ['uuid', 'UUID', 'folioFiscal']);
      if (!uuid) {
        return {
          status: 'REJECTED',
          messages: this.messagesOf(body),
          raw: body,
        };
      }

      return {
        status: 'ACCEPTED',
        trackingId: uuid,
        authorization: this.pick(body, ['xml', 'cfdi', 'xmlTimbrado']) ?? null,
        messages: this.messagesOf(body),
        raw: body,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const body = axiosError.response?.data as Record<string, unknown> | undefined;

      // A 4xx carrying the PAC's own validation messages is the document being refused; anything
      // else is the exchange failing, and the document's fate is unknown until we ask again.
      if (axiosError.response && axiosError.response.status < 500) {
        return {
          status: 'REJECTED',
          messages: body ? this.messagesOf(body) : [axiosError.message],
          raw: body ?? axiosError.message,
        };
      }

      this.logger.warn(`El PAC no respondió al timbrar: ${axiosError.message}`);
      return {
        status: 'PENDING',
        messages: [axiosError.message],
        raw: body ?? axiosError.message,
      };
    }
  }

  private pick(body: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  /** Every message the PAC sent, verbatim: they are what a rejection is diagnosed from. */
  private messagesOf(body: Record<string, unknown>): string[] {
    const collected: string[] = [];
    for (const key of ['message', 'mensaje', 'error', 'errores', 'messages']) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) collected.push(value.trim());
      if (Array.isArray(value)) {
        collected.push(...value.map((item) => String(item)).filter(Boolean));
      }
    }
    return collected;
  }
}
