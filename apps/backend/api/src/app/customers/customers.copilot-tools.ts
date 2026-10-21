import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, agingForModel, opt, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { CustomersService } from './customers.service';
import { CustomerPaymentsService } from './customer-payments.service';

/** Customers and receivables, as copilot tools. Same permissions and branch scope as the screens. */
@Injectable()
export class CustomersCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly customers: CustomersService,
    private readonly payments: CustomerPaymentsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'search_customers',
        branchScope: 'none',
        externalText: true,
        description: "Find customers by name, tax identifier (the market's own: RNC, RFC, EIN…) or e-mail. Returns ids for use in other tools, with payment terms and credit limit.",
        permissions: [PERMISSIONS.CUSTOMERS_VIEW],
        inputSchema: s.object({ query: s.string('Name, tax id or e-mail fragment'), limit: s.integer('1-25') }),
        run: async (ctx, input) => {
          const rows = await this.customers.findAll(ctx.organizationId, {
            search: String(input['query'] ?? ''),
            limit: Math.min(Math.max(Number(input['limit'] ?? 10), 1), 25),
          });
          return rows.map((c) => ({
            id: c.id,
            name: c.companyName,
            taxId: c.taxId ?? null,
            email: c.email,
            paymentTermDays: c.paymentTermDays ?? null,
            creditLimit: c.creditLimit ?? null,
          }));
        },
      },
      {
        kind: 'read',
        name: 'receivables_aging',
        branchScope: 'applied',
        externalText: true,
        description:
          'Accounts receivable ageing: what customers owe, split into current and days-past-due buckets, with the ' +
          'largest balances first. Use for "who owes me", "overdue customers", "collections".',
        permissions: [PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW],
        inputSchema: s.object({ as_of: s.nullable(s.string('YYYY-MM-DD; today when null')) }),
        run: async (ctx, input) =>
          agingForModel(
            await this.payments.aging(ctx.organizationId, opt<string>(input, 'as_of') ?? new Date(), { actorUserId: ctx.user.id }),
          ),
      },
    );
  }
}
