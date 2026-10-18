import { Injectable } from '@nestjs/common';
import { BadRequestError } from '../i18n/localized.exception';
import { WorkflowSubject } from './contracts/workflow-graph';
import { WorkflowSubprocessStarter } from './actions/builtin-actions';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { MAX_SUBPROCESS_DEPTH, WorkflowEngineService } from './workflow-engine.service';

/**
 * Starts a published process from inside another (SAP sub-workflow).
 *
 * The child inherits the parent's context, records its parent, and counts its depth, so a process
 * that starts itself (directly or in a ring) is stopped after a handful of levels instead of
 * spawning instances without end.
 */
@Injectable()
export class WorkflowSubprocessService extends WorkflowSubprocessStarter {
  constructor(
    private readonly definitions: WorkflowDefinitionsService,
    private readonly engine: WorkflowEngineService,
  ) {
    super();
  }

  async startByKey(
    organizationId: string,
    key: string,
    context: Record<string, unknown>,
    parent: { instanceId: string; subjectLabel: string | null; startedByUserId: string | null; subject?: WorkflowSubject | null },
  ): Promise<string> {
    const definition = await this.definitions.getPublishedByKey(key, organizationId);
    if (!definition) throw new BadRequestError('workflow_engine.subprocess_unknown', { key });
    const depth = Number(context['__workflowDepth'] ?? 0) + 1;
    if (depth > MAX_SUBPROCESS_DEPTH) throw new BadRequestError('workflow_engine.subprocess_too_deep');
    const child = await this.engine.start(
      definition,
      {
        context: { ...context, __workflowDepth: depth, parentInstanceId: parent.instanceId },
        subject: parent.subject ?? (parent.subjectLabel ? { label: parent.subjectLabel } : null),
        startedByUserId: parent.startedByUserId,
        parentInstanceId: parent.instanceId,
      },
      organizationId,
    );
    return child.id;
  }
}
