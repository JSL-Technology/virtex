
import { Injectable, Logger } from '@nestjs/common';
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

    @OnEvent(AuthEvents.LOGIN_SUCCESS)
    async handleLoginSuccess(payload: AuthLoginSuccessEvent) {
        await this.auditService.record(
            payload.userId,
            'User',
            payload.userId,
            ActionType.LOGIN,
            {
                email: payload.email,
                ipAddress: payload.ipAddress,
                userAgent: payload.userAgent,
                correlationId: payload.correlationId
            },
            undefined
        );
        this.logger.log(`[${payload.correlationId || 'NO-TRACE'}] User ${payload.email} logged in from ${payload.ipAddress}`);
    }

    @OnEvent(AuthEvents.LOGIN_FAILED)
    async handleLoginFailed(payload: AuthLoginFailedEvent) {
        await this.auditService.record(
            payload.userId,
            'User',
            payload.userId,
            ActionType.LOGIN_FAILED,
            {
                email: payload.email,
                reason: payload.reason,
                ipAddress: payload.ipAddress,
                correlationId: payload.correlationId
            },
            undefined
        );
        this.logger.warn(`[${payload.correlationId || 'NO-TRACE'}] Login failed for ${payload.email}: ${payload.reason}`);
    }

    @OnEvent(AuthEvents.IMPERSONATE)
    async handleImpersonate(payload: AuthImpersonateEvent) {
        await this.auditService.record(
            payload.adminId,
            'User',
            payload.targetUserId,
            ActionType.IMPERSONATE,
            {
                targetUserEmail: payload.targetUserEmail,
                adminEmail: payload.adminEmail
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
