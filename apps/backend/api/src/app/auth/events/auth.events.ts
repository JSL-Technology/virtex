
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditTrailService } from '../../audit/audit.service';
import { ActionType } from '../../audit/entities/audit-log.entity';

export enum AuthEvents {
    LOGIN_SUCCESS = 'auth.login.success',
    LOGIN_FAILED = 'auth.login.failed',
    IMPERSONATE = 'auth.impersonate',
    LOGOUT = 'auth.logout',
    TWO_FACTOR_ENABLED = 'auth.2fa.enabled',
    TWO_FACTOR_DISABLED = 'auth.2fa.disabled',
    AUDIT_ACTION = 'auth.audit.action',
    /**
     * One or more session families have been revoked.
     *
     * Emitted by `SessionService` on logout, "revoke device", "close other sessions", global
     * logout and refresh-token reuse. The HTTP path does not need it — `UserIdentityService`
     * consults the denylist on every request — but a WebSocket is already connected and will
     * never make another authenticated request, so nothing would ever re-check it. This is what
     * lets `EventsGateway` hang up on a socket the moment its session ends, instead of leaving it
     * receiving the tenant's events until the access token expires.
     */
    SESSIONS_REVOKED = 'auth.sessions.revoked',

    /**
     * An authentication attempt was refused because the account is locked out.
     *
     * Exists because the HTTP reply can no longer say so. A locked account answers exactly as a
     * wrong password does — same code, same body, same latency — since the difference was an
     * oracle telling an attacker which guess was right (see `AuthService.login`). The legitimate
     * owner therefore cannot learn about the lockout from the response, and must learn about it
     * through a channel that already proves they own the address.
     *
     * This is that channel's hook. `AuthAuditListener` records every occurrence; a notification
     * listener attaches here without reopening the oracle, because what it sends goes to the
     * address on the account rather than to whoever is doing the guessing.
     */
    ACCOUNT_LOCKED = 'auth.account.locked',
}

export class AuthLoginSuccessEvent {
    constructor(
        public readonly userId: string,
        public readonly email: string,
        public readonly ipAddress?: string,
        public readonly userAgent?: string,
        public readonly correlationId?: string
    ) {}
}

export class AuthLoginFailedEvent {
    constructor(
        public readonly userId: string,
        public readonly email: string,
        public readonly reason: string,
        public readonly ipAddress?: string,
        public readonly userAgent?: string,
        public readonly correlationId?: string
    ) {}
}

/**
 * An attempt was refused because the account is locked out.
 *
 * `lockoutUntil` travels here and NOT in the HTTP reply: that is the whole point. Inside the
 * process it is what a notification needs in order to tell the owner when they may try again;
 * on the wire it was what told an attacker their guess had been correct.
 */
export class AuthAccountLockedEvent {
    constructor(
        public readonly userId: string,
        public readonly email: string,
        public readonly lockoutUntil: Date | null,
        /** Whether the refused attempt actually carried the right password. Never leaves the server. */
        public readonly credentialsWereValid: boolean,
        public readonly ipAddress?: string,
        public readonly userAgent?: string,
        public readonly correlationId?: string
    ) {}
}

export class AuthImpersonateEvent {
    constructor(
        public readonly adminId: string,
        public readonly targetUserId: string,
        public readonly adminEmail: string,
        public readonly targetUserEmail: string
    ) {}
}

export class AuthAuditActionEvent {
    constructor(
        public readonly userId: string,
        public readonly entityType: string,
        public readonly entityId: string,
        public readonly action: ActionType,
        public readonly details?: Record<string, any>,
        public readonly correlationId?: string
    ) {}
}

/** The session families that were just revoked, and who they belonged to. */
export class AuthSessionsRevokedEvent {
    constructor(
        public readonly userId: string,
        public readonly sessionIds: readonly string[],
    ) {}
}

@Injectable()
export class AuthSubscriber {
    private readonly logger = new Logger(AuthSubscriber.name);

    constructor(private readonly auditService: AuditTrailService) {}

    @OnEvent(AuthEvents.IMPERSONATE)
    async handleImpersonate(payload: AuthImpersonateEvent) {
        await this.auditService.record(
            payload.adminId,
            'User',
            payload.targetUserId,
            ActionType.IMPERSONATE,
            {
                targetEmailHash: createHash('sha256').update(payload.targetUserEmail ?? '').digest('hex').slice(0, 16),
                adminEmailHash: createHash('sha256').update(payload.adminEmail ?? '').digest('hex').slice(0, 16),
            },
            undefined
        );
    }

    @OnEvent(AuthEvents.AUDIT_ACTION)
    async handleAuditAction(payload: AuthAuditActionEvent) {
        try {
            await this.auditService.record(
                payload.userId,
                payload.entityType,
                payload.entityId,
                payload.action,
                { ...payload.details, correlationId: payload.correlationId },
                undefined
            );
        } catch (error) {
            this.logger.error(`Failed to record audit log asynchronously: ${(error as Error).message}`);
        }
    }
}
