import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CopilotToolContext,
  CopilotToolRegistry,
  asValidDto,
  opt,
  partyName,
  s,
} from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceStatus } from './entities/invoice.entity';

const LINE = s.object({
  product_id: s.nullable(s.string('Product id from search_products; null for a free-text line')),
  description: s.nullable(s.string('Required when there is no product')),
  quantity: s.number('> 0'),
  unit_price: s.nullable(s.number("Null to use the product's own sale price")),
});

/**
 * Sales invoices, as copilot tools: reading them, and proposing a DRAFT. The draft is built and
 * priced by the same `preview` the invoice form uses; it is created (never issued) only when the
 * person confirms, and issuing it — which assigns the fiscal number — stays on the invoice screen.
 */
@Injectable()
export class InvoicesCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly invoices: InvoicesService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'list_invoices',
        branchScope: 'applied',
        externalText: true,
        description:
          'Sales invoices, newest first, filtered by status, customer, issue-date range or a number/name fragment. ' +
          "Returns number, fiscal number (the authority's number where the market has one, e.g. NCF, CFDI folio), customer, dates, total, balance and status.",
        permissions: [PERMISSIONS.INVOICES_VIEW],
        inputSchema: s.object({
          status: s.nullable(s.enum(Object.values(InvoiceStatus))),
          customer_id: s.nullable(s.string()),
          from: s.nullable(s.string('Issue date from, YYYY-MM-DD')),
          to: s.nullable(s.string('Issue date to, YYYY-MM-DD')),
          search: s.nullable(s.string('Invoice number, fiscal number or customer name fragment')),
          limit: s.integer('1-50'),
        }),
        run: async (ctx, input) => {
          const page = await this.invoices.findAll(ctx.organizationId, {
            status: opt(input, 'status'),
            customerId: opt(input, 'customer_id'),
            from: opt(input, 'from'),
            to: opt(input, 'to'),
            search: opt(input, 'search'),
            limit: Math.min(Math.max(Number(input['limit'] ?? 20), 1), 50),
            actorUserId: ctx.user.id,
          });
          return {
            total: page.total,
            items: page.items.map((invoice) => ({
              id: invoice.id,
              number: invoice.invoiceNumber,
              fiscalNumber: invoice.fiscalNumber ?? null,
              customer: invoice.customerName,
              issueDate: invoice.issueDate,
              dueDate: invoice.dueDate,
              currency: invoice.currencyCode,
              total: Number(invoice.total),
              balance: Number(invoice.balance),
              status: invoice.status,
            })),
          };
        },
      },
      {
        kind: 'read',
        name: 'get_invoice',
        branchScope: 'applied',
        externalText: true,
        description: 'One sales invoice with its lines, taxes and payments status.',
        permissions: [PERMISSIONS.INVOICES_VIEW],
        inputSchema: s.object({ id: s.string('Invoice id from list_invoices') }),
        run: async (ctx, input) => {
          const invoice = await this.invoices.findOne(String(input['id']), ctx.organizationId, ctx.user.id);
          return {
            id: invoice.id,
            number: invoice.invoiceNumber,
            fiscalNumber: invoice.fiscalNumber ?? null,
            customer: invoice.customerName,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            currency: invoice.currencyCode,
            subtotal: Number(invoice.subtotal),
            tax: Number(invoice.tax),
            total: Number(invoice.total),
            balance: Number(invoice.balance),
            status: invoice.status,
            lines: (invoice.lineItems ?? []).map((line) => ({
              description: line.description,
              quantity: Number(line.quantity),
              price: Number(line.price),
              total: Number(line.lineSubtotal ?? 0),
            })),
          };
        },
      },
      {
        kind: 'draft',
        name: 'draft_invoice',
        branchScope: 'applied',
        description:
          'PROPOSE a sales invoice as a draft (not issued, no fiscal number). The person sees the priced preview and ' +
          'confirms it themselves. Resolve the customer and products with search_customers / search_products first.',
        permissions: [PERMISSIONS.INVOICES_CREATE],
        inputSchema: s.object({
          customer_id: s.string(),
          issue_date: s.nullable(s.string('YYYY-MM-DD; today when null')),
          due_date: s.nullable(s.string("YYYY-MM-DD; from the customer's payment terms when null")),
          notes: s.nullable(s.string()),
          lines: s.array(LINE),
        }),
        propose: async (ctx, input) => {
          const dto = await this.toDto(ctx, input);
          const computed = await this.invoices.preview(dto, ctx.organizationId);
          const names = await productNames(this.dataSource, ctx.organizationId, dto.lineItems.map((line) => line.productId));
          const customer = await partyName(this.dataSource, 'customer', ctx.organizationId, dto.customerId);
          return {
            // Dates resolved now: confirmed tomorrow, the invoice still carries the dates shown.
            input: { ...input, issue_date: dto.issueDate, due_date: dto.dueDate },
            summary: `Draft invoice for ${customer} · ${dto.lineItems.length} line(s) · total ${computed.total}`,
            preview: {
              customerId: dto.customerId,
              customerName: customer,
              issueDate: dto.issueDate,
              dueDate: dto.dueDate,
              subtotal: computed.subtotal,
              tax: computed.tax,
              total: computed.total,
              lines: computed.lines.map((line, index) => ({
                description: dto.lineItems[index]?.description || names.get(dto.lineItems[index]?.productId ?? '') || '',
                quantity: Number(dto.lineItems[index]?.quantity ?? 0),
                subtotal: line.subtotal,
                tax: line.taxAmount,
              })),
            },
          };
        },
        commit: async (ctx, input) => {
          const dto = await this.toDto(ctx, input);
          const invoice = await this.invoices.create(dto, ctx.organizationId, ctx.user.id);
          return { id: invoice.id, link: `/invoices/${invoice.id}`, label: invoice.invoiceNumber ?? '' };
        },
      },
    );
  }

  private async toDto(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<CreateInvoiceDto> {
    const issueDate = opt<string>(input, 'issue_date') ?? new Date().toISOString().slice(0, 10);
    let dueDate = opt<string>(input, 'due_date');
    if (!dueDate) {
      const [terms] = await this.dataSource.query(
        `SELECT c."payment_term_days" AS "customer", s."default_payment_term_days" AS "company"
           FROM "customers" c
           LEFT JOIN "organization_settings" s ON s."organization_id" = c."organization_id"
          WHERE c."id" = $1 AND c."organization_id" = $2`,
        [String(input['customer_id']), ctx.organizationId],
      );
      const days = Number(terms?.customer ?? terms?.company ?? 0);
      dueDate = new Date(Date.parse(issueDate) + Math.max(0, days) * 86_400_000).toISOString().slice(0, 10);
    }
    const lines = Array.isArray(input['lines']) ? (input['lines'] as Array<Record<string, unknown>>) : [];
    return asValidDto(CreateInvoiceDto, {
      customerId: input['customer_id'],
      issueDate,
      dueDate,
      notes: opt(input, 'notes'),
      // Always a draft: issuing assigns the fiscal number and is done on the invoice screen.
      issue: false,
      lineItems: lines.map((line) => ({
        productId: opt(line, 'product_id'),
        description: opt(line, 'description'),
        quantity: line['quantity'],
        unitPrice: opt(line, 'unit_price'),
      })),
    });
  }
}

/** Product names by id, for previews of lines that name a product but carry no description. */
export async function productNames(dataSource: DataSource, organizationId: string, ids: Array<string | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return new Map<string, string>();
  const rows: Array<{ id: string; name: string }> = await dataSource.query(
    `SELECT "id", "name" FROM "products" WHERE "organization_id" = $1 AND "id" = ANY($2::uuid[])`,
    [organizationId, wanted],
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}
