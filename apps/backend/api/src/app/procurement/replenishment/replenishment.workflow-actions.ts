import { Injectable, OnModuleInit } from '@nestjs/common';
import { WorkflowActionContext, WorkflowActionRegistry, WorkflowActionResult } from '../../workflow-engine/contracts/workflow-actions';
import { ReplenishmentAgentService } from './replenishment-agent.service';

/**
 * «Run the replenishment agent» as a workflow step — for a company that wants it at a moment of
 * its own choosing (after a stock count, say) rather than every morning. Writes drafts, or sends
 * them for approval, exactly as the scheduled run under the company's settings.
 */
@Injectable()
export class ReplenishmentWorkflowActions implements OnModuleInit {
  constructor(
    private readonly registry: WorkflowActionRegistry,
    private readonly agent: ReplenishmentAgentService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      key: 'replenishment_agent',
      labelKey: 'workflow_engine.action.replenishment_agent',
      descriptionKey: 'workflow_engine.action_help.replenishment_agent',
      outcomes: ['ordered', 'nothing'],
      params: [],
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const result = await this.agent.run(ctx.organizationId, null, 'WORKFLOW');
        return {
          outcome: result.orders.length ? 'ordered' : 'nothing',
          patch: { replenishmentOrders: result.orders.map((order) => order.label) },
          summary: result.orders.length
            ? `Replenishment agent drafted ${result.orders.length} purchase order(s): ${result.orders.map((order) => order.label).join(', ')}.`
            : 'Replenishment agent: nothing to order.',
        };
      },
    });
  }
}
