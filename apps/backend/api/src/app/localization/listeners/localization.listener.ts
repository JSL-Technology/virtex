import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class LocalizationListener {
  // Placeholder implementation to satisfy build requirements

  @OnEvent('user.registered')
  handleUserRegistered(payload: any) {
    // Logic to handle user registration related to localization
    // e.g. setting up default currency, tax settings based on country
  }
}
