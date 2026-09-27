
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditTrailService } from '../../audit/audit.service';
import { ActionType } from '../../audit/entities/audit-log.entity';
import {
  AuthAccountLockedEvent,
  AuthEvents,
  AuthLoginSuccessEvent,
  AuthLoginFailedEvent,
} from '../events/auth.events';

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

  /**
   * An attempt refused by the lockout, recorded where the HTTP reply can no longer say it.
   *
   * The reply to a locked account is now identical to the reply to a wrong password, because the
   * difference between them told an attacker which guess had worked. That uniformity is only
   * affordable if the distinction survives somewhere an operator can read it — otherwise closing
   * the oracle would have cost the ability to see a credential-stuffing run land on a real
   * password. `credentialsWereValid` is exactly that signal, and it never crosses the wire.
   */
  @OnEvent(AuthEvents.ACCOUNT_LOCKED)
  async handleAccountLocked(event: AuthAccountLockedEvent) {
    const maskedEmail = this.maskEmail(event.email);
    this.logger.warn(
      `[${event.correlationId ?? 'NO-TRACE'}] Attempt on locked account — email: ${maskedEmail}, ` +
        `credentials ${event.credentialsWereValid ? 'VALID' : 'invalid'}, ip: ${this.maskIp(event.ipAddress)}`,
    );
    await this.auditService.record(
      event.userId,
      'User',
      event.userId,
      ActionType.LOGIN_FAILED,
      {
        emailHash: createHash('sha256').update(event.email ?? '').digest('hex').slice(0, 16),
        emailMasked: maskedEmail,
        reason: 'Account Locked',
        // The alarm worth waking someone for: the guessing has found the password and is only
        // being held off by the lockout window.
        credentialsWereValid: event.credentialsWereValid,
        lockoutUntil: event.lockoutUntil?.toISOString(),
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
