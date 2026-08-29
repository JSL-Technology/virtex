import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Twilio } from 'twilio';
import { AuthConfig } from '../auth.config';
import { AbstractSmsProvider } from './abstract-sms.provider';

// Normalize phone to E.164. Handles the most common user input patterns.
// Dominican Republic uses NANP (+1), so 10-digit numbers (with or without +) get +1 prepended.
function normalizeToE164(phone: string): string {
  const stripped = phone.replace(/[\s\-().]/g, '');
  // Already correct E.164: + followed by 11-15 digits (country code + subscriber)
  if (/^\+\d{11,15}$/.test(stripped)) return stripped;
  // + followed by exactly 10 digits → country code missing, assume NANP (+1)
  if (/^\+(\d{10})$/.test(stripped)) return `+1${stripped.slice(1)}`;
  // 11 digits starting with 1 → NANP with country code, just add +
  if (/^1\d{10}$/.test(stripped)) return `+${stripped}`;
  // 10 bare digits → NANP, add +1
  if (/^\d{10}$/.test(stripped)) return `+1${stripped}`;
  return stripped;
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
      this.logger.log(`SMS sent successfully to ${normalized}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${normalized}: ${(error as Error).message}`);
      throw error;
    }
  }
}
