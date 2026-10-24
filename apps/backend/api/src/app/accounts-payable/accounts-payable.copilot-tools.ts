import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, agingForModel, opt, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { AccountsPayableService } from './accounts-payable.service';

/** Payables, read-only: paying is a step-up operation and never offered to the copilot. */
@Injectable()
export class AccountsPayableCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly payables: AccountsPayableService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      kind: 'read',
      name: 'payables_aging',
      branchScope: 'applied',
      externalText: true,
      description:
        'Accounts payable ageing: what is owed to suppliers, split into current and days-past-due buckets, largest ' +
        'balances first. Use for "what do I owe", "bills due", "overdue suppliers".',
      permissions: [PERMISSIONS.ACCOUNTS_PAYABLE_VIEW],
      inputSchema: s.object({ as_of: s.nullable(s.string('YYYY-MM-DD; today when null')) }),
      run: async (ctx, input) =>
        agingForModel(await this.payables.aging(ctx.organizationId, opt<string>(input, 'as_of') ?? new Date(), { actorUserId: ctx.user.id })),
    });
  }
}
