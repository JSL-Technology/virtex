import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, opt, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { InventoryService } from './inventory.service';
import { StockQueriesService } from './stock-queries.service';

@Injectable()
export class InventoryCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly inventory: InventoryService,
    private readonly stock: StockQueriesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'search_products',
        branchScope: 'none',
        externalText: true,
        description: 'Find products by name or SKU. Returns ids, sale price, unit cost, unit of measure and total stock, for use in other tools and drafts.',
        permissions: [PERMISSIONS.PRODUCTS_VIEW],
        inputSchema: s.object({ query: s.string('Name or SKU fragment'), limit: s.integer('1-25') }),
        run: async (ctx, input) => {
          const rows = await this.inventory.findAll(ctx.organizationId, {
            search: String(input['query'] ?? ''),
            limit: Math.min(Math.max(Number(input['limit'] ?? 10), 1), 25),
          });
          return rows.map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            price: Number(p.price),
            cost: Number(p.cost),
            unitOfMeasure: p.unitOfMeasure,
            stock: Number(p.stock),
            kind: p.kind,
            category: p.category?.name ?? null,
          }));
        },
      },
      {
        kind: 'read',
        name: 'stock_on_hand',
        branchScope: 'none',
        externalText: true,
        description: 'Quantity on hand per product and warehouse, now. Filter by product, warehouse or a name fragment.',
        permissions: [PERMISSIONS.INVENTORY_VIEW_STOCK],
        inputSchema: s.object({
          product_id: s.nullable(s.string('Product id from search_products')),
          warehouse_id: s.nullable(s.string()),
          search: s.nullable(s.string('Product name or SKU fragment')),
          limit: s.integer('1-50'),
        }),
        run: async (ctx, input) =>
          this.stock.onHand(ctx.organizationId, {
            productId: opt(input, 'product_id'),
            warehouseId: opt(input, 'warehouse_id'),
            search: opt(input, 'search'),
            limit: Math.min(Math.max(Number(input['limit'] ?? 25), 1), 50),
          }),
      },
    );
  }
}
