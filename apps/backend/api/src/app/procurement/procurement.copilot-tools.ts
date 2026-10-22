import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CopilotToolContext, CopilotToolRegistry, asValidDto, opt, partyName, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/purchase-order.dto';
import { PurchaseOrderStatus } from './entities/purchase-order.entity';

/**
 * Purchase orders, as copilot tools: listing them, and proposing a DRAFT order. Submitting it for
 * approval and sending it to the supplier stay on the purchase-order screen.
 */
@Injectable()
export class ProcurementCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly orders: PurchaseOrdersService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'list_purchase_orders',
        branchScope: 'applied',
        records: 'purchase_order',
        externalText: true,
        description: 'Purchase orders, filtered by status or supplier, with dates, total and status.',
        permissions: [PERMISSIONS.PROCUREMENT_VIEW],
        inputSchema: s.object({
          status: s.nullable(s.enum(Object.values(PurchaseOrderStatus))),
          supplier_id: s.nullable(s.string()),
          limit: s.integer('1-50'),
        }),
        run: async (ctx, input) => {
          const page = await this.orders.findAll(
            ctx.organizationId,
            {
              status: opt(input, 'status'),
              supplierId: opt(input, 'supplier_id'),
              pageSize: Math.min(Math.max(Number(input['limit'] ?? 20), 1), 50),
            },
            ctx.user.id,
          );
          return {
            total: page.total,
            items: page.rows.map((order) => ({
              id: order.id,
              number: order.number,
              supplier: order.supplier?.name ?? null,
              orderDate: order.orderDate,
              expectedDate: order.expectedDate,
              total: Number(order.total),
              status: order.status,
            })),
          };
        },
      },
      {
        kind: 'draft',
        name: 'draft_purchase_order',
        branchScope: 'applied',
        description:
          "PROPOSE a purchase order as a draft. Prices default to each product's last unit cost. Use inventory_forecast " +
          '(suggested order quantities) and search_suppliers / search_products first. The person confirms it themselves.',
        permissions: [PERMISSIONS.PROCUREMENT_MANAGE],
        inputSchema: s.object({
          supplier_id: s.string(),
          expected_date: s.nullable(s.string('YYYY-MM-DD')),
          notes: s.nullable(s.string()),
          lines: s.array(
            s.object({
              product_id: s.nullable(s.string()),
              description: s.nullable(s.string('Required when there is no product')),
              quantity: s.number('> 0'),
              unit_price: s.nullable(s.number('Null for the product cost')),
            }),
          ),
        }),
        propose: async (ctx, input) => {
          const dto = await this.toDto(ctx, input);
          const subtotal = dto.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice), 0);
          const supplier = await partyName(this.dataSource, 'supplier', ctx.organizationId, dto.supplierId);
          return {
            // Costs resolved now are the ones committed (see `CopilotDraftProposal.input`).
            input: {
              ...input,
              lines: dto.lines.map((line) => ({
                product_id: line.productId ?? null,
                description: line.description ?? null,
                quantity: line.quantity,
                unit_price: line.unitPrice ?? null,
              })),
            },
            summary: `Draft purchase order to ${supplier} · ${dto.lines.length} line(s) · subtotal ${Math.round(subtotal * 100) / 100}`,
            preview: {
              supplierId: dto.supplierId,
              supplierName: supplier,
              expectedDate: dto.expectedDate ?? null,
              subtotal: Math.round(subtotal * 100) / 100,
              lines: dto.lines.map((line) => ({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice })),
            },
          };
        },
        commit: async (ctx, input) => {
          const order = await this.orders.create(await this.toDto(ctx, input), ctx.organizationId, ctx.user.id);
          return { id: order.id, entityType: 'purchase_order', link: `/purchasing/orders/${order.id}/edit`, label: order.number ?? '' };
        },
      },
    );
  }

  private async toDto(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<CreatePurchaseOrderDto> {
    const lines = Array.isArray(input['lines']) ? (input['lines'] as Array<Record<string, unknown>>) : [];
    const ids = lines.map((line) => opt<string>(line, 'product_id')).filter((id): id is string => !!id);
    const catalogue = new Map<string, { name: string; cost: number }>();
    if (ids.length) {
      const rows: Array<{ id: string; name: string; cost: string }> = await this.dataSource.query(
        `SELECT "id", "name", "cost" FROM "products" WHERE "organization_id" = $1 AND "id"::text = ANY($2::text[])`,
        [ctx.organizationId, ids],
      );
      for (const row of rows) catalogue.set(row.id, { name: row.name, cost: Number(row.cost) });
    }
    return asValidDto(CreatePurchaseOrderDto, {
      supplierId: input['supplier_id'],
      expectedDate: opt(input, 'expected_date'),
      notes: opt(input, 'notes'),
      lines: lines.map((line) => {
        const product = catalogue.get(opt<string>(line, 'product_id') ?? '');
        return {
          productId: opt(line, 'product_id'),
          description: opt<string>(line, 'description') ?? product?.name,
          quantity: line['quantity'],
          unitPrice: opt<number>(line, 'unit_price') ?? product?.cost,
        };
      }),
    });
  }
}
