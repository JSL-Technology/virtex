import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { SuppliersService } from './suppliers.service';

@Injectable()
export class SuppliersCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly suppliers: SuppliersService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      kind: 'read',
      name: 'search_suppliers',
      branchScope: 'none',
      externalText: true,
      description: "Find suppliers by name, tax identifier (the market's own) or e-mail. Returns ids for use in other tools.",
      permissions: [PERMISSIONS.SUPPLIERS_VIEW],
      inputSchema: s.object({ query: s.string('Name, tax id or e-mail fragment'), limit: s.integer('1-25') }),
      run: async (ctx, input) => {
        const rows = await this.suppliers.findAll(ctx.organizationId, {
          search: String(input['query'] ?? ''),
          limit: Math.min(Math.max(Number(input['limit'] ?? 10), 1), 25),
        });
        return rows.map((supplier) => ({ id: supplier.id, name: supplier.name, taxId: supplier.taxId ?? null, email: supplier.email ?? null }));
      },
    });
  }
}
