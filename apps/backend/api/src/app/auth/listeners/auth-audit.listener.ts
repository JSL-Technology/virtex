
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthEvents, AuthLoginSuccessEvent, AuthLoginFailedEvent } from '../events/auth.events';

@Injectable()
export class AuthAuditListener {
  private readonly logger = new Logger(AuthAuditListener.name);

  @OnEvent(AuthEvents.LOGIN_SUCCESS)
  handleLoginSuccess(event: AuthLoginSuccessEvent) {
    this.logger.log(`Audit: Login Success - User: ${event.userId}, IP: ${event.ipAddress}, Agent: ${event.userAgent}`);
    // In a real implementation, save to AuditLog entity
  }

  @OnEvent(AuthEvents.LOGIN_FAILED)
  handleLoginFailed(event: AuthLoginFailedEvent) {
    this.logger.warn(`Audit: Login Failed - User: ${event.email}, Reason: ${event.reason}, IP: ${event.ipAddress}`);
    // In a real implementation, save to AuditLog entity
  }
}
