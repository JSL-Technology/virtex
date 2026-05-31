
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditTrailService } from '../../audit/audit.service';
import { ActionType } from '../../audit/entities/audit-log.entity';
import { AuthEvents, AuthLoginSuccessEvent, AuthLoginFailedEvent } from '../events/auth.events';

@Injectable()
export class AuthAuditListener {
  private readonly logger = new Logger(AuthAuditListener.name);

  constructor(private readonly auditService: AuditTrailService) {}

  @OnEvent(AuthEvents.LOGIN_SUCCESS)
  async handleLoginSuccess(event: AuthLoginSuccessEvent) {
    this.logger.log(
      `[${event.correlationId ?? 'NO-TRACE'}] Login success — user: ${event.userId}, ip: ${event.ipAddress}`,
    );
    await this.auditService.record(
      event.userId,
      'User',
      event.userId,
      ActionType.LOGIN,
      { email: event.email, ipAddress: event.ipAddress, userAgent: event.userAgent },
      undefined,
    );
  }

  @OnEvent(AuthEvents.LOGIN_FAILED)
  async handleLoginFailed(event: AuthLoginFailedEvent) {
    this.logger.warn(
      `[${event.correlationId ?? 'NO-TRACE'}] Login failed — email: ${event.email}, reason: ${event.reason}, ip: ${event.ipAddress}`,
    );
    await this.auditService.record(
      event.userId,
      'User',
      event.userId,
      ActionType.LOGIN_FAILED,
      { email: event.email, reason: event.reason, ipAddress: event.ipAddress },
      undefined,
    );
  }
}
