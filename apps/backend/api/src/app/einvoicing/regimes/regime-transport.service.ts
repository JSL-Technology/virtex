import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { FiscalTransmissionResult } from './fiscal-regime.types';

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
 * A hardcoded endpoint for any authority. Every one of these requires the taxpayer's own
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

  constructor(private readonly config: ConfigService) {}

  /**
   * The configuration a regime needs to transmit at all, read under its own prefix:
   * `EINVOICE_MX_ENDPOINT`, `EINVOICE_CO_TOKEN`, and so on.
   */
  configurationFor(regimeCode: string): { endpoint?: string; credential?: string; soapAction?: string } {
    const prefix = `EINVOICE_${regimeCode.toUpperCase()}`;
    const token = this.config.get<string>(`${prefix}_TOKEN`);
    const user = this.config.get<string>(`${prefix}_USERNAME`);
    const password = this.config.get<string>(`${prefix}_PASSWORD`);

    return {
      endpoint: this.config.get<string>(`${prefix}_ENDPOINT`),
      credential: token
        ? `Bearer ${token}`
        : user && password
          ? `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
          : undefined,
      soapAction: this.config.get<string>(`${prefix}_SOAP_ACTION`),
    };
  }

  /**
   * Post the document and read the verdict.
   *
   * A network failure is `PENDING`, never `REJECTED`: the authority may well have accepted it, and
   * a taxpayer who reissues on a timeout ends with two fiscal documents for one sale — a worse
   * problem than a status unknown for an hour.
   */
  async send(
    regimeCode: string,
    payload: string,
    options: { contentType: string; trackingKeys?: string[] },
  ): Promise<FiscalTransmissionResult> {
    const { endpoint, credential, soapAction } = this.configurationFor(regimeCode);
    if (!endpoint) {
      return {
        status: 'NOT_CONFIGURED',
        messages: [
          `EINVOICE_${regimeCode.toUpperCase()}_ENDPOINT no está configurado; el documento queda ` +
            'construido y firmado, sin transmitir.',
        ],
      };
    }

    try {
      const response = await axios.post(endpoint, payload, {
        headers: {
          'Content-Type': options.contentType,
          ...(credential ? { Authorization: credential } : {}),
          ...(soapAction ? { SOAPAction: soapAction } : {}),
        },
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
