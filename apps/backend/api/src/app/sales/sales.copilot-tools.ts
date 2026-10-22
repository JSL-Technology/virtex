import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CopilotToolContext, CopilotToolRegistry, asValidDto, opt, partyName, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { QuotesService } from './services/quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

const QUOTE_VALID_DAYS = 15;

/** Quotes, as copilot tools: listing them, and proposing a DRAFT priced from the catalogue. */
@Injectable()
export class SalesCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly quotes: QuotesService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'list_quotes',
        branchScope: 'applied',
        records: 'quote',
        externalText: true,
        description: 'Sales quotes, filtered by status (DRAFT, SENT, ACCEPTED, REJECTED, CANCELLED, INVOICED), with customer, dates, total and whether expired.',
        permissions: [PERMISSIONS.INVOICES_VIEW],
        inputSchema: s.object({ status: s.nullable(s.string('Quote status')), limit: s.integer('1-50') }),
        run: async (ctx, input) => {
          const rows = await this.quotes.findAll(ctx.organizationId, { status: opt(input, 'status') }, ctx.user.id);
          const limit = Math.min(Math.max(Number(input['limit'] ?? 20), 1), 50);
          return {
            total: rows.length,
            items: rows.slice(0, limit).map((quote) => ({
              id: quote.id,
              number: quote.quoteNumber,
              customer: quote.customer?.companyName ?? null,
              issueDate: quote.issueDate,
              expiryDate: quote.expiryDate,
              total: Number(quote.total),
              status: quote.status,
              expired: quote.expired,
            })),
          };
        },
      },
      {
        kind: 'draft',
        name: 'draft_quote',
        branchScope: 'applied',
        description:
          "PROPOSE a sales quote as a draft. Prices default to each product's catalogue price; a discount rate (0-1) " +
          'per line is optional. The person sees the priced preview and confirms it themselves. Resolve the customer ' +
          'and products with search_customers / search_products first.',
        permissions: [PERMISSIONS.INVOICES_CREATE],
        inputSchema: s.object({
          customer_id: s.string(),
          valid_days: s.nullable(s.integer(`Days the quote is valid; ${QUOTE_VALID_DAYS} when null`)),
          notes: s.nullable(s.string()),
          lines: s.array(
            s.object({
              product_id: s.nullable(s.string()),
              description: s.nullable(s.string('Required when there is no product')),
              quantity: s.number('> 0'),
              unit_price: s.nullable(s.number('Null for the catalogue price')),
              discount_rate: s.nullable(s.number('0-1')),
            }),
          ),
        }),
        propose: async (ctx, input) => {
          const dto = await this.toDto(ctx, input);
          const computed = await this.quotes.preview(dto, ctx.organizationId);
          const customer = await partyName(this.dataSource, 'customer', ctx.organizationId, dto.customerId);
          return {
            // Prices, descriptions and dates resolved now are the ones committed (see `CopilotDraftProposal.input`).
            input: {
              ...input,
              issue_date: dto.issueDate,
              lines: dto.lines.map((line) => ({
                product_id: line.productId ?? null,
                description: line.description ?? null,
                quantity: line.quantity,
                unit_price: line.unitPrice ?? null,
                discount_rate: line.discountRate ?? null,
              })),
            },
            summary: `Draft quote for ${customer} · ${dto.lines.length} line(s) · total ${computed.total}`,
            preview: {
              customerId: dto.customerId,
              customerName: customer,
              issueDate: dto.issueDate,
              expiryDate: dto.expiryDate,
              subtotal: computed.subtotal,
              tax: computed.tax,
              total: computed.total,
              lines: dto.lines.map((line, index) => ({
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                subtotal: computed.lines[index]?.subtotal ?? null,
              })),
            },
          };
        },
        commit: async (ctx, input) => {
          const quote = await this.quotes.create(await this.toDto(ctx, input), ctx.organizationId, { id: ctx.user.id });
          return { id: quote.id, entityType: 'quote', link: `/quotes/${quote.id}/edit`, label: quote.quoteNumber ?? '' };
        },
      },
    );
  }

  /** Lines without a price or description take the catalogue's, so the preview is what will be quoted. */
  private async toDto(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<CreateQuoteDto> {
    const lines = Array.isArray(input['lines']) ? (input['lines'] as Array<Record<string, unknown>>) : [];
    const ids = lines.map((line) => opt<string>(line, 'product_id')).filter((id): id is string => !!id);
    const catalogue = new Map<string, { name: string; price: number }>();
    if (ids.length) {
      const rows: Array<{ id: string; name: string; price: string }> = await this.dataSource.query(
        `SELECT "id", "name", "price" FROM "products" WHERE "organization_id" = $1 AND "id"::text = ANY($2::text[])`,
        [ctx.organizationId, ids],
      );
      for (const row of rows) catalogue.set(row.id, { name: row.name, price: Number(row.price) });
    }
    // A frozen proposal carries its issue date; the model's input never does (not in its schema).
    const issueDate = opt<string>(input, 'issue_date') ?? new Date().toISOString().slice(0, 10);
    const validDays = Math.min(Math.max(Number(opt(input, 'valid_days') ?? QUOTE_VALID_DAYS), 1), 365);
    return asValidDto(CreateQuoteDto, {
      customerId: input['customer_id'],
      issueDate,
      expiryDate: new Date(Date.parse(issueDate) + validDays * 86_400_000).toISOString().slice(0, 10),
      notes: opt(input, 'notes'),
      lines: lines.map((line) => {
        const product = catalogue.get(opt<string>(line, 'product_id') ?? '');
        return {
          productId: opt(line, 'product_id'),
          description: opt<string>(line, 'description') ?? product?.name,
          quantity: line['quantity'],
          unitPrice: opt<number>(line, 'unit_price') ?? product?.price,
          discountRate: opt(line, 'discount_rate'),
        };
      }),
    });
  }
}
