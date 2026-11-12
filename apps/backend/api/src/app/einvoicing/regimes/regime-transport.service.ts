import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { FiscalTransmissionResult } from './fiscal-regime.types';
import { externalEffectAllowed, ExternalEffect } from '../../config/external-effects';
import { TransmissionConfigService } from '../services/transmission-config.service';
import { publicOnlyHttpsAgent } from '../../common/net/outbound-address';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

/**
 * Sending a signed document to the authority the tenant is registered with.
 *
 * ## Why one transport and not seven
 *
 * The six regimes that receive a document all receive it the same way: an HTTP POST of the signed
 * payload to an endpoint, with a credential, answered with a tracking handle and a list of
 * messages. What differs is the envelope — some are SOAP, some are multipart, one is a base64 ZIP
 * — and the endpoint, and both of those are configuration rather than code.
 *
 * ## What is deliberately not here
 *
 * A hardcoded endpoint for any authority, or one shared by every tenant (FAC-EINV-04): the target
 * is the tenant's own, from `TransmissionConfigService`. Every one of these requires the taxpayer's own
 * certificate and, in most cases, a homologation process the authority runs against that
 * taxpayer's own account before production traffic is accepted. So the endpoint, the credential
 * and the envelope come from the tenant's configuration, and a regime with none configured
 * answers `NOT_CONFIGURED` — the document stays built and signed, which is its true state.
 *
 * That is the same posture the Dominican adapter has had in production: `DgiiTransportService`
 * reads its endpoints from configuration too. Nothing here simulates an authority, and no response
 * is fabricated.
 */
@Injectable()
export class RegimeTransportService {
  private readonly logger = new Logger(RegimeTransportService.name);
  /** Connects only to public addresses, checked at connect time (no DNS rebinding). */
  private readonly agent = publicOnlyHttpsAgent();

  constructor(
    private readonly config: ConfigService,
    private readonly targets: TransmissionConfigService,
  ) {}

  /**
   * Post the document and read the verdict.
   *
   * The endpoint and credential are the tenant's own (FAC-EINV-04). A network failure is
   * `PENDING`, never `REJECTED`: the authority may well have accepted it, and a taxpayer who
   * reissues on a timeout ends with two fiscal documents for one sale — a worse problem than a
   * status unknown for an hour.
   */
  async send(
    regimeCode: string,
    payload: string,
    options: { contentType: string; trackingKeys?: string[]; organizationId: string; purpose: 'submit' | 'status' },
  ): Promise<FiscalTransmissionResult> {
    const target = await this.targets.resolve(options.organizationId, regimeCode);
    if (!target) {
      return {
        status: 'NOT_CONFIGURED',
        messages: [
          `La transmisión de ${regimeCode.toUpperCase()} no está configurada para la empresa (Ajustes › Facturación electrónica); ` +
            'el documento queda construido y firmado, sin transmitir.',
        ],
      };
    }
    if (!externalEffectAllowed(ExternalEffect.FiscalAuthority)) {
      // Not transmitted, and said so: never an invented verdict (config/external-effects.ts).
      return {
        status: 'NOT_CONFIGURED',
        messages: ['La comunicación con la autoridad fiscal está desactivada en este entorno (EXTERNAL_EFFECTS); el documento queda construido y firmado, sin transmitir.'],
      };
    }

    const endpoint = options.purpose === 'status' ? target.statusEndpoint : target.endpoint;
    try {
      const response = await axios.post(endpoint, payload, {
        headers: {
          'Content-Type': options.contentType,
          Authorization: target.authorization,
          ...(target.soapAction ? { SOAPAction: target.soapAction } : {}),
        },
        httpsAgent: this.agent,
        // A redirect could lead off the checked host; the authority does not redirect a POST.
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_REQUEST_BYTES,
        timeout: Number(this.config.get<string>('EINVOICE_TIMEOUT_MS') ?? 45_000),
        // The authority answers XML as often as JSON; parsing is the caller's business.
        responseType: 'text',
        transformResponse: [(data) => data],
      });

      const body = String(response.data ?? '');
      const trackingId = this.extract(body, options.trackingKeys ?? []);
      return {
        status: trackingId ? 'ACCEPTED' : 'PENDING',
        trackingId,
        messages: this.messagesOf(body),
        raw: body,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const body = String(axiosError.response?.data ?? axiosError.message);

      // A 4xx carrying the authority's own validation messages is the document being refused;
      // anything else is the exchange failing, and the document's fate is unknown until we ask.
      if (axiosError.response && axiosError.response.status < 500) {
        return { status: 'REJECTED', messages: this.messagesOf(body), raw: body };
      }

      this.logger.warn(`${regimeCode}: la autoridad no respondió — ${axiosError.message}`);
      return { status: 'PENDING', messages: [axiosError.message], raw: body };
    }
  }

  /** The first of the named elements or JSON keys that carries a value. */
  private extract(body: string, keys: string[]): string | null {
    for (const key of keys) {
      const element = new RegExp(`<(?:\\w+:)?${key}>([^<]+)</`, 'i').exec(body);
      if (element?.[1]?.trim()) return element[1].trim();
      const json = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i').exec(body);
      if (json?.[1]?.trim()) return json[1].trim();
    }
    return null;
  }

  /**
   * Every message the authority sent, verbatim.
   *
   * Never summarised: a rejection is diagnosed from the authority's own wording, and a paraphrase
   * is what makes a support conversation impossible.
   */
  private messagesOf(body: string): string[] {
    const messages: string[] = [];
    for (const pattern of [
      /<(?:\w+:)?(?:Descripcion|description|mensaje|Message|Motivo|xMotivo|Obs)>([^<]+)</gi,
      /"(?:message|mensaje|descripcion|error)"\s*:\s*"([^"]+)"/gi,
    ]) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(body)) !== null) {
        const text = match[1].trim();
        if (text && !messages.includes(text)) messages.push(text);
      }
    }
    return messages;
  }
}
