import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LanguageCode } from '@virteex/shared/types';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  WorkflowAction,
  WorkflowActionContext,
  WorkflowActionRegistry,
  WorkflowActionResult,
} from '../workflow-action.registry';

/** The language a workflow notification is written in until per-user resolution is added. */
const DEFAULT_LANGUAGE = 'es' as LanguageCode;

/** How long a webhook may take before the step gives up and records the failure. */
const WEBHOOK_TIMEOUT_MS = 8000;

/**
 * The actions every workflow can use without any module having to register one.
 *
 * They are the universal verbs — note a fact, set a variable, tell someone, call out to another
 * system — and nothing here reaches into a domain: a «post this invoice» action belongs to Ventas
 * and registers itself. Keeping these four in the engine is what makes a workflow useful the moment
 * the feature is installed, rather than only after another module has taught it a trick.
 */
@Injectable()
export class BuiltinWorkflowActions implements OnModuleInit {
  private readonly logger = new Logger(BuiltinWorkflowActions.name);

  constructor(
    private readonly registry: WorkflowActionRegistry,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.log());
    this.registry.register(this.setVariable());
    this.registry.register(this.notify());
    this.registry.register(this.webhook());
  }

  /** Write a line to the instance timeline. A marker, for processes that want an explicit beat. */
  private log(): WorkflowAction {
    return {
      key: 'log',
      labelKey: 'workflow_engine.action.log',
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        this.logger.log(`[wf ${ctx.instanceId}] ${String(ctx.params['message'] ?? '')}`);
        return {};
      },
    };
  }

  /** Set a context variable: `{ name, value }` → `context[name] = value`. */
  private setVariable(): WorkflowAction {
    return {
      key: 'set_variable',
      labelKey: 'workflow_engine.action.set_variable',
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const name = String(ctx.params['name'] ?? '').trim();
        if (!name) return {};
        return { patch: { [name]: ctx.params['value'] ?? null } };
      },
    };
  }

  /** Notify a user: `{ userId?, message }`. Defaults to whoever started the instance. */
  private notify(): WorkflowAction {
    return {
      key: 'notify',
      labelKey: 'workflow_engine.action.notify',
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const userId = (ctx.params['userId'] as string) || ctx.startedByUserId;
        const message = String(ctx.params['message'] ?? '');
        if (!userId) return {};
        await this.notifications
          .createLocalizedNotification(userId, DEFAULT_LANGUAGE, {
            titleKey: 'workflow_engine.notify.custom_title',
            bodyKey: 'workflow_engine.notify.custom_body',
            params: { message },
            organizationId: ctx.organizationId,
          })
          .catch((error: unknown) =>
            this.logger.warn(`notify falló: ${(error as Error)?.message ?? error}`),
          );
        return {};
      },
    };
  }

  /**
   * Call an external URL: `{ url, method?, body? }`.
   *
   * A failure is recorded in the context (`webhook.ok = false`) rather than thrown, so a flaky
   * endpoint stalls nothing — the branch continues and a condition downstream can react to the
   * result. The call is time-boxed so a hung endpoint cannot hold a step open.
   */
  private webhook(): WorkflowAction {
    return {
      key: 'webhook',
      labelKey: 'workflow_engine.action.webhook',
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const url = String(ctx.params['url'] ?? '').trim();
        if (!/^https?:\/\//i.test(url)) {
          return { patch: { webhook: { ok: false, reason: 'invalid_url' } } };
        }
        const method = String(ctx.params['method'] ?? 'POST').toUpperCase();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
        try {
          const response = await fetch(url, {
            method,
            signal: controller.signal,
            headers: { 'content-type': 'application/json' },
            body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(ctx.params['body'] ?? {}),
          });
          return { patch: { webhook: { ok: response.ok, status: response.status } } };
        } catch (error) {
          return {
            patch: { webhook: { ok: false, reason: (error as Error)?.name ?? 'error' } },
          };
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }
}
