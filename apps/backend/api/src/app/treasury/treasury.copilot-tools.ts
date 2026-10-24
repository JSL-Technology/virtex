import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, opt, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { TreasuryService } from './treasury.service';

/** Treasury, read-only: moving money is a step-up operation and never offered to the copilot. */
@Injectable()
export class TreasuryCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly treasury: TreasuryService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      kind: 'read',
      name: 'cash_position',
      branchScope: 'none',
      description: 'Cash and bank balances per account at a date, and the total. Use for "how much cash do I have".',
      permissions: [PERMISSIONS.TREASURY_VIEW],
      inputSchema: s.object({ as_of: s.nullable(s.string('YYYY-MM-DD; today when null')) }),
      run: async (ctx, input) => this.treasury.cashPosition(ctx.organizationId, opt<string>(input, 'as_of')),
    });
  }
}
