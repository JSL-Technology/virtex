import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { FiscalTransmissionResult } from '../fiscal-regime.types';
import { externalEffectAllowed, ExternalEffect } from '../../../config/external-effects';
import { TransmissionConfigService } from '../../services/transmission-config.service';
import { publicOnlyHttpsAgent } from '../../../common/net/outbound-address';

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

  /** Connects only to public addresses, checked at connect time. */
  private readonly agent = publicOnlyHttpsAgent();

  constructor(
    private readonly config: ConfigService,
    private readonly targets: TransmissionConfigService,
  ) {}

  /** Whether this tenant has its own PAC configured (FAC-EINV-04). */
  configured(organizationId: string): Promise<boolean> {
    return this.targets.isConfigured(organizationId, 'MX');
  }

  async stamp(sealedXml: string, organizationId: string): Promise<FiscalTransmissionResult> {
    const target = await this.targets.resolve(organizationId, 'MX');
    if (!target) {
      return {
        status: 'NOT_CONFIGURED',
        messages: ['El PAC de la empresa no está configurado (Ajustes › Facturación electrónica); el CFDI queda sellado, sin timbrar.'],
      };
    }
    if (!externalEffectAllowed(ExternalEffect.FiscalAuthority)) {
      // Not transmitted, and said so: never an invented verdict (config/external-effects.ts).
      return {
        status: 'NOT_CONFIGURED',
        messages: ['La comunicación con el PAC está desactivada en este entorno (EXTERNAL_EFFECTS); el documento queda construido y firmado, sin transmitir.'],
      };
    }
    const url = target.endpoint;
    const credential = target.authorization;

    try {
      const response = await axios.post(
        url,
        { xml: Buffer.from(sealedXml, 'utf8').toString('base64') },
        {
          headers: { Authorization: credential, 'Content-Type': 'application/json' },
          httpsAgent: this.agent,
          maxRedirects: 0,
          maxContentLength: 5 * 1024 * 1024,
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
