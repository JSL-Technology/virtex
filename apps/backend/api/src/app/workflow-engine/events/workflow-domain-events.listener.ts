import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { WorkflowTriggerService } from '../workflow-trigger.service';
import { WORKFLOW_EVENT_CATALOGUE } from './workflow-event.catalogue';

/**
 * Bridges the business events the domain modules emit to the processes subscribed to them.
 *
 * It subscribes by name to every catalogued event, so the engine never imports the module that
 * emitted it. The work is deferred off the emitter's call stack and run in its own tenant job: the
 * request that emitted the event has usually finished (and released its connection) by the time a
 * process starts, and a process failing to start must never fail the invoice that triggered it.
 */
@Injectable()
export class WorkflowDomainEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowDomainEventsListener.name);
  private readonly handlers = new Map<string, (payload: unknown) => void>();

  constructor(
    private readonly events: EventEmitter2,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly triggers: WorkflowTriggerService,
  ) {}

  onModuleInit(): void {
    for (const definition of WORKFLOW_EVENT_CATALOGUE) {
      const handler = (payload: unknown) => {
        setImmediate(() => void this.handle(definition.key, payload));
      };
      this.handlers.set(definition.key, handler);
      this.events.on(definition.key, handler);
    }
  }

  onModuleDestroy(): void {
    for (const [key, handler] of this.handlers) this.events.off(key, handler);
    this.handlers.clear();
  }

  async handle(eventName: string, payload: unknown): Promise<void> {
    const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const organizationId = typeof raw['organizationId'] === 'string' ? (raw['organizationId'] as string) : null;
    if (!organizationId) return;
    try {
      const started = await runAsTenantJob(this.dataSource, organizationId, () =>
        this.triggers.fromDomainEvent(organizationId, eventName, raw),
      );
      if (started > 0) this.logger.log(`${eventName}: ${started} flujo(s) iniciado(s) (empresa ${organizationId}).`);
    } catch (error) {
      this.logger.error(`${eventName}: no se pudieron iniciar los flujos suscritos: ${(error as Error)?.message ?? error}`);
    }
  }
}
