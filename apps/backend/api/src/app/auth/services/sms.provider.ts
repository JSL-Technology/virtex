import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Twilio } from 'twilio';
import { AuthConfig } from '../auth.config';
import { AbstractSmsProvider } from './abstract-sms.provider';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * Tidy an E.164 number for the provider, without guessing a country.
 *
 * The previous version prepended `+1` to any bare ten-digit input, on the reasoning that the
 * Dominican Republic is NANP. Mexico, Colombia and Argentina also use ten-digit national numbers,
 * so a Mexican customer typing `5512345678` had their verification code sent to `+15512345678` —
 * a New Jersey landline. There is no way to infer the country from digits alone, and inventing one
 * sends a code to a stranger and charges us for it.
 *
 * Callers must supply E.164. Every entry point now enforces that (`IsE164PhoneNumber` on the
 * profile DTO, `IsVerificationTarget` on the public verification DTO), so this only strips the
 * formatting a human types and rejects anything that is still not E.164.
 */
export function normalizeToE164(phone: string): string {
  const stripped = phone.replace(/[\s\-().]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(stripped)) {
    throw new BadRequestError('AUTH.NUMERO_DEBE_ESTAR_FORMATO_INTERNACIONAL_164_INCLUYENDO');
  }
  return stripped;
}

/** Country code plus a short digest: correlatable, not identifying. */
function maskPhone(e164: string): string {
  const digits = e164.replace(/^\+/, '');
  const digest = createHash('sha256').update(digits).digest('hex').slice(0, 10);
  return `+${digits.slice(0, 3)}…${digest}`;
}

@Injectable()
export class TwilioSmsProvider implements AbstractSmsProvider {
  private readonly client!: Twilio;
  private readonly logger = new Logger(TwilioSmsProvider.name);

  constructor() {
    if (AuthConfig.TWILIO_ACCOUNT_SID && AuthConfig.TWILIO_AUTH_TOKEN) {
        this.client = new Twilio(AuthConfig.TWILIO_ACCOUNT_SID, AuthConfig.TWILIO_AUTH_TOKEN);
    } else {
        this.logger.warn('Twilio credentials not found. SMS will not be sent.');
    }
  }

  async send(to: string, body: string): Promise<void> {
    if (!this.client) {
        // Returning quietly here told the caller the code had been sent. The user then waited for
        // an SMS that was never going to arrive, with no error anywhere to explain it. A missing
        // credential is a configuration fault and has to surface as one.
        this.logger.error(
          { event: 'sms_provider_unconfigured' },
          'Twilio credentials are not configured; cannot send SMS.',
        );
        throw new ServiceUnavailableException(
          'El envío de SMS no está disponible en este momento. Usa la verificación por correo.',
        );
    }

    const normalized = normalizeToE164(to);

    try {
      await this.client.messages.create({
        body,
        from: AuthConfig.TWILIO_PHONE_NUMBER,
        to: normalized,
      });
      // The destination is personal data. Logged as a country code plus a salted hash, which is
      // enough to correlate delivery problems and to spot a pumping pattern, and useless to
      // anyone reading the logs. Everything else in this module already follows that rule —
      // hashed emails, masked IPs, truncated user agents — and these two lines did not.
      this.logger.log(
        { event: 'sms_sent', destination: maskPhone(normalized) },
        'Verification SMS sent',
      );
    } catch (error) {
      this.logger.error(
        { event: 'sms_send_failed', destination: maskPhone(normalized) },
        `Failed to send verification SMS: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
