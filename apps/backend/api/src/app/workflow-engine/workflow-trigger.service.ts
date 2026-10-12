import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowEngineService } from './workflow-engine.service';

/** What an event carries into the instances it starts. */
export interface WorkflowEventPayload {
  context?: Record<string, unknown>;
  subject?: { type?: string; id?: string; label?: string };
  actorUserId?: string | null;
}

/**
 * Starts instances from business events.
 *
 * A published definition may declare an event trigger (`{ mode: 'event', event: 'invoice.created' }`).
 * When that event fires for a tenant, every matching definition starts. The firing is a method other
 * modules call (`fire(org, 'invoice.created', …)`) rather than a global event subscription, so a
 * process is wired to a business fact deliberately and the engine never has to listen to everything
 * the application emits. Exported from the module so an operational module can call it directly.
 */
@Injectable()
export class WorkflowTriggerService {
  constructor(
    @InjectRepository(WorkflowDefinition)
    private readonly definitions: Repository<WorkflowDefinition>,
    private readonly engine: WorkflowEngineService,
  ) {}

  /** Start every published definition whose event trigger matches. Returns how many started. */
  async fire(
    organizationId: string,
    eventName: string,
    payload: WorkflowEventPayload = {},
  ): Promise<number> {
    const published = await this.definitions.find({
      where: { organizationId, status: WorkflowDefinitionStatus.PUBLISHED },
    });
    const matching = published.filter(
      (definition) =>
        definition.trigger?.mode === 'event' && definition.trigger.event === eventName,
    );

    for (const definition of matching) {
      await this.engine.start(
        definition,
        {
          context: { event: eventName, ...(payload.context ?? {}) },
          subject: payload.subject,
          startedByUserId: payload.actorUserId ?? null,
        },
        organizationId,
      );
    }
    return matching.length;
  }
}
