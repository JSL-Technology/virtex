import { Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';
import { AuthConfig } from '../auth.config';
import { AbstractSmsProvider } from './abstract-sms.provider';

@Injectable()
export class TwilioSmsProvider implements AbstractSmsProvider {
  private readonly client: Twilio;
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
        this.logger.warn(`Twilio client not initialized. Skipped sending SMS to ${to}`);
        return;
    }

    try {
      await this.client.messages.create({
        body,
        from: AuthConfig.TWILIO_PHONE_NUMBER,
        to,
      });
      this.logger.log(`SMS sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${to}: ${(error as Error).message}`);
      throw error;
    }
  }
}
