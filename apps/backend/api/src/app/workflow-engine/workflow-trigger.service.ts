import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestError } from '../i18n/localized.exception';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowSubject } from './contracts/workflow-graph';
import { evaluatePredicate } from './contracts/workflow-predicate';
import { sanitizeContext } from './contracts/workflow-context';
import { eventDefinition, isKnownWorkflowEvent } from './events/workflow-event.catalogue';
import { WorkflowEngineService } from './workflow-engine.service';

export interface WorkflowEventPayload {
  context?: Record<string, unknown>;
  subject?: WorkflowSubject | null;
  actorUserId?: string | null;
}

/**
 * Starts the processes subscribed to a business event.
 *
 * Two doors lead here: the domain listener (a quote was accepted, an invoice issued — mapped through
 * the event catalogue so only business fields reach the process), and the API, for integrations
 * firing `custom.*` events. A definition's optional trigger filter is evaluated against the event's
 * context first, so «only invoices over 10 000» needs no condition node at the top of the graph.
 * One subscribed process failing to start never prevents the others.
 */
@Injectable()
export class WorkflowTriggerService {
  private readonly logger = new Logger(WorkflowTriggerService.name);

  constructor(
    @InjectRepository(WorkflowDefinition)
    private readonly definitions: Repository<WorkflowDefinition>,
    private readonly engine: WorkflowEngineService,
  ) {}

  /** From a domain event's raw payload. */
  async fromDomainEvent(organizationId: string, eventName: string, raw: Record<string, unknown>): Promise<number> {
    const definition = eventDefinition(eventName);
    if (!definition) return 0;
    const mapped = definition.map(raw);
    return this.fire(organizationId, eventName, mapped);
  }

  /** Start every published definition whose event trigger matches. Returns how many started. */
  async fire(organizationId: string, eventName: string, payload: WorkflowEventPayload = {}): Promise<number> {
    if (!isKnownWorkflowEvent(eventName)) throw new BadRequestError('workflow_engine.unknown_event', { event: eventName });
    const published = await this.definitions
      .createQueryBuilder('d')
      .where('d.organization_id = :organizationId AND d.status = :status', { organizationId, status: WorkflowDefinitionStatus.PUBLISHED })
      .andWhere(`d.trigger->>'mode' = 'event' AND d.trigger->>'event' = :eventName`, { eventName })
      .getMany();

    const context = { event: eventName, ...sanitizeContext(payload.context ?? {}) };
    let started = 0;
    for (const definition of published) {
      if (definition.trigger.filter && !evaluatePredicate(definition.trigger.filter, context)) continue;
      try {
        await this.engine.start(
          definition,
          { context, subject: payload.subject ?? null, startedByUserId: payload.actorUserId ?? null },
          organizationId,
        );
        started += 1;
      } catch (error) {
        this.logger.error(
          `No se pudo iniciar «${definition.key}» v${definition.version} por ${eventName}: ${(error as Error)?.message ?? error}`,
        );
      }
    }
    return started;
  }
}
