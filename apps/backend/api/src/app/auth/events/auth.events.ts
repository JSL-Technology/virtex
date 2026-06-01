
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
