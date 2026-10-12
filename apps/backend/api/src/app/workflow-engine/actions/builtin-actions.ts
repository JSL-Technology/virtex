import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NotificationsService } from '../../notifications/notifications.service';
import { callWebhook } from '../security/safe-webhook';
import {
  WorkflowAction,
  WorkflowActionContext,
  WorkflowActionRegistry,
  WorkflowActionResult,
} from '../workflow-action.registry';
import { WorkflowDirectoryService, interpolate } from '../workflow-directory.service';

/** Starts a published process by key. Resolved lazily so the actions do not depend on the engine. */
export abstract class WorkflowSubprocessStarter {
  abstract startByKey(
    organizationId: string,
    key: string,
    context: Record<string, unknown>,
    parent: { instanceId: string; subjectLabel: string | null; startedByUserId: string | null },
  ): Promise<string>;
}

/**
 * The actions every workflow can use without any module having to register one.
 *
 * They are the universal verbs — note a fact, set a variable, tell someone, call out to another
 * system, start another process — and nothing here reaches into a domain: a «post this invoice»
 * action belongs to Ventas and registers itself. Text parameters accept `{{variable}}` placeholders
 * rendered from the instance context, so a message can say which document it is about.
 */
@Injectable()
export class BuiltinWorkflowActions implements OnModuleInit {
  private readonly logger = new Logger(BuiltinWorkflowActions.name);

  constructor(
    private readonly registry: WorkflowActionRegistry,
    private readonly notifications: NotificationsService,
    private readonly directory: WorkflowDirectoryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.log());
    this.registry.register(this.setVariable());
    this.registry.register(this.notify());
    this.registry.register(this.webhook());
    this.registry.register(this.subprocess());
  }

  /** Write a line to the instance timeline. A marker, for processes that want an explicit beat. */
  private log(): WorkflowAction {
    return {
      key: 'log',
      labelKey: 'workflow_engine.action.log',
      descriptionKey: 'workflow_engine.action_help.log',
      params: [
        { name: 'message', labelKey: 'workflow_engine.param.message', type: 'text', required: true, templated: true, maxLength: 1000 },
      ],
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const message = interpolate(String(ctx.params['message'] ?? ''), ctx.context).slice(0, 1000);
        this.logger.log(`[wf ${ctx.instanceId}] ${message}`);
        return { summary: message };
      },
    };
  }

  /** Set a context variable: `{ name, value }` → `context[name] = value`. */
  private setVariable(): WorkflowAction {
    return {
      key: 'set_variable',
      labelKey: 'workflow_engine.action.set_variable',
      descriptionKey: 'workflow_engine.action_help.set_variable',
      params: [
        { name: 'name', labelKey: 'workflow_engine.param.variable_name', type: 'string', required: true, maxLength: 64 },
        { name: 'value', labelKey: 'workflow_engine.param.value', type: 'string', templated: true, maxLength: 1000 },
      ],
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const name = String(ctx.params['name'] ?? '').trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return {};
        const raw = ctx.params['value'];
        const value = typeof raw === 'string' ? coerce(interpolate(raw, ctx.context)) : (raw ?? null);
        return { patch: { [name]: value }, summary: `${name} = ${typeof value === 'object' ? JSON.stringify(value) : String(value)}` };
      },
    };
  }

  /** Notify a user (or everyone in a role): defaults to whoever started the instance. */
  private notify(): WorkflowAction {
    return {
      key: 'notify',
      labelKey: 'workflow_engine.action.notify',
      descriptionKey: 'workflow_engine.action_help.notify',
      params: [
        { name: 'userId', labelKey: 'workflow_engine.param.recipient', type: 'user', hintKey: 'workflow_engine.param.recipient_hint' },
        { name: 'title', labelKey: 'workflow_engine.param.title', type: 'string', templated: true, maxLength: 160 },
        { name: 'message', labelKey: 'workflow_engine.param.message', type: 'text', required: true, templated: true, maxLength: 1000 },
      ],
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const userId = (ctx.params['userId'] as string) || ctx.startedByUserId;
        const message = interpolate(String(ctx.params['message'] ?? ''), ctx.context).slice(0, 1000);
        const title = interpolate(String(ctx.params['title'] ?? ''), ctx.context).slice(0, 160);
        if (!userId) return { summary: 'no recipient' };
        const [recipient] = await this.directory.users(ctx.organizationId, undefined, [userId]);
        if (!recipient) return { summary: 'recipient not in company' };
        await this.notifications
          .createLocalizedNotification(recipient.id, recipient.language, {
            titleKey: title ? 'workflow_engine.notify.custom_title_text' : 'workflow_engine.notify.custom_title',
            bodyKey: 'workflow_engine.notify.custom_body',
            params: { message, title, subject: ctx.subjectLabel ?? '' },
            link: `/workflow-instances/${ctx.instanceId}`,
            organizationId: ctx.organizationId,
          })
          .catch((error: unknown) => this.logger.warn(`notify falló: ${(error as Error)?.message ?? error}`));
        return { summary: recipient.name };
      },
    };
  }

  /**
   * Call an external URL with the SSRF guard in front of it.
   *
   * A failure is recorded in the context (`webhook.ok = false`) and returned as the `error` outcome
   * rather than thrown, so a flaky endpoint stalls nothing — the author routes the `error` outcome
   * wherever the process should go, and a condition downstream can read the status.
   */
  private webhook(): WorkflowAction {
    return {
      key: 'webhook',
      labelKey: 'workflow_engine.action.webhook',
      descriptionKey: 'workflow_engine.action_help.webhook',
      outcomes: ['ok', 'error'],
      params: [
        { name: 'url', labelKey: 'workflow_engine.param.url', type: 'url', required: true, maxLength: 2000, hintKey: 'workflow_engine.param.url_hint' },
        { name: 'method', labelKey: 'workflow_engine.param.method', type: 'select', options: ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'] },
        { name: 'body', labelKey: 'workflow_engine.param.body', type: 'json', templated: true, maxLength: 16000, hintKey: 'workflow_engine.param.body_hint' },
      ],
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const url = String(ctx.params['url'] ?? '').trim();
        const method = String(ctx.params['method'] ?? 'POST').toUpperCase();
        const body = renderBody(ctx.params['body'], ctx.context);
        const result = await callWebhook(url, method, body, {
          'x-virtex-workflow-instance': ctx.instanceId,
          'x-virtex-workflow-node': ctx.nodeId,
        });
        return {
          outcome: result.ok ? 'ok' : 'error',
          patch: { webhook: { ok: result.ok, status: result.status ?? null, reason: result.reason ?? null, response: result.body ?? null } },
          summary: result.ok ? `HTTP ${result.status}` : `${result.reason ?? 'HTTP ' + result.status}`,
        };
      },
    };
  }

  /** Start another published process (SAP sub-workflow), passing it the current context. */
  private subprocess(): WorkflowAction {
    return {
      key: 'start_workflow',
      labelKey: 'workflow_engine.action.start_workflow',
      descriptionKey: 'workflow_engine.action_help.start_workflow',
      params: [
        { name: 'workflowKey', labelKey: 'workflow_engine.param.workflow', type: 'string', required: true, maxLength: 120, hintKey: 'workflow_engine.param.workflow_hint' },
      ],
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const starter = this.moduleRef.get(WorkflowSubprocessStarter, { strict: false });
        const key = String(ctx.params['workflowKey'] ?? '').trim();
        const childId = await starter.startByKey(ctx.organizationId, key, ctx.context, {
          instanceId: ctx.instanceId,
          subjectLabel: ctx.subjectLabel,
          startedByUserId: ctx.startedByUserId,
        });
        return { patch: { subprocess: { key, instanceId: childId } }, summary: key };
      },
    };
  }
}

function coerce(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}

/** A JSON body whose string leaves are templates; a plain string is parsed as JSON when it is one. */
function renderBody(raw: unknown, context: Record<string, unknown>): unknown {
  if (raw === undefined || raw === null || raw === '') return { ...context };
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return interpolate(raw, context);
    }
  }
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 10) return null;
    if (typeof node === 'string') return interpolate(node, context);
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v, depth + 1)]));
    }
    return node;
  };
  return walk(value, 0);
}
