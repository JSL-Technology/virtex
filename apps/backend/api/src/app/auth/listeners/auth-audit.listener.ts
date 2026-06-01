
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
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
    const maskedEmail = this.maskEmail(event.email);
    this.logger.log(
      `[${event.correlationId ?? 'NO-TRACE'}] Login success — user: ${event.userId}, ip: ${this.maskIp(event.ipAddress)}`,
    );
    await this.auditService.record(
      event.userId,
      'User',
      event.userId,
      ActionType.LOGIN,
      {
        emailHash: createHash('sha256').update(event.email ?? '').digest('hex').slice(0, 16),
        emailMasked: maskedEmail,
        ipAddressMasked: this.maskIp(event.ipAddress),
        userAgentTruncated: event.userAgent ? event.userAgent.substring(0, 100) : undefined,
      },
      undefined,
    );
  }

  @OnEvent(AuthEvents.LOGIN_FAILED)
  async handleLoginFailed(event: AuthLoginFailedEvent) {
    const maskedEmail = this.maskEmail(event.email);
    this.logger.warn(
      `[${event.correlationId ?? 'NO-TRACE'}] Login failed — email: ${maskedEmail}, reason: ${event.reason}, ip: ${this.maskIp(event.ipAddress)}`,
    );
    await this.auditService.record(
      event.userId,
      'User',
      event.userId,
      ActionType.LOGIN_FAILED,
      {
        emailHash: createHash('sha256').update(event.email ?? '').digest('hex').slice(0, 16),
        emailMasked: maskedEmail,
        reason: event.reason,
        ipAddressMasked: this.maskIp(event.ipAddress),
      },
      undefined,
    );
  }

  private maskEmail(email: string): string {
    if (!email || !email.includes('@')) return email;
    const [user, domain] = email.split('@');
    if (user.length <= 2) return `${user}***@${domain}`;
    return `${user[0]}***${user[user.length - 1]}@${domain}`;
  }

  private maskIp(ip?: string): string {
    if (!ip) return '***';
    return ip.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.*.*');
  }
}
