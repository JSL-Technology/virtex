import { Injectable, OnModuleInit } from '@nestjs/common';
import { CopilotToolRegistry, capped, opt, s } from '../contracts/copilot/copilot-tools.contract';
import { PERMISSIONS } from '../shared/permissions';
import { MESSAGE_TONES, MessageTone } from '../invoices/dto/compose-invoice-message.dto';
import { CollectionsService } from './collections.service';
import { WORKLIST_ACTIONS } from './dto/collections.dto';
import { CollectionAction } from './collection-priority';

/**
 * Collections as copilot tools: the ranked worklist to read, and a reminder to draft. The draft is
 * saved for a person to review and send from Sales › Collections; the copilot never sends one.
 */
@Injectable()
export class CollectionsCopilotTools implements OnModuleInit {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly collections: CollectionsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        kind: 'read',
        name: 'collections_worklist',
        description:
          'Open invoices ranked by who to chase first: balance, days overdue, how likely each is to be paid within ' +
          '30 days without action, promises kept or broken, and the suggested next action (call, firm_reminder, ' +
          'reminder, courtesy_reminder, await_promise, wait). Use for "a quién cobro hoy", "cobranza", "who should I chase".',
        permissions: [PERMISSIONS.AI_COLLECTIONS_VIEW, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW],
        feature: 'ai_collections',
        inputSchema: s.object({
          customer_id: s.nullable(s.string('Only this customer')),
          action: s.nullable(s.enum(WORKLIST_ACTIONS, 'Only invoices with this suggested action')),
          limit: s.nullable(s.integer('1-30, default 15')),
        }),
        run: async (ctx, input) => {
          const list = await this.collections.worklist(ctx.organizationId, ctx.user.id, {
            customerId: opt<string>(input, 'customer_id'),
            action: opt<CollectionAction>(input, 'action'),
            limit: 30,
          });
          const limit = Math.min(Math.max(Number(opt<number>(input, 'limit') ?? 15), 1), 30);
          return {
            asOfDate: list.asOfDate,
            baseCurrency: list.baseCurrency,
            likelihoodFrom: list.projectionAt ? 'cash-flow projection' : 'invoice age only (no projection yet)',
            totals: list.totals,
            ...capped(
              list.items.map((item) => ({
                invoiceId: item.invoiceId,
                number: item.number,
                customer: item.customerName,
                customerId: item.customerId,
                dueDate: item.dueDate,
                daysOverdue: item.daysOverdue,
                balance: item.balance,
                currency: item.currencyCode,
                pPaidWithin30Days: item.pBy30,
                expectedDate: item.expectedDate,
                action: item.action,
                suggestedTone: item.suggestedTone,
                reasons: item.reasons,
                brokenPromises: item.brokenPromises,
                openPromise: item.openPromise,
                hasDraftReminder: !!item.draftReminderId,
              })),
              limit,
              list.total,
            ),
          };
        },
      },
      {
        kind: 'draft',
        name: 'draft_payment_reminder',
        description:
          'Draft a payment reminder e-mail for one open invoice, in the given tone (cordial, formal, firm). The note is ' +
          'written from the invoice\'s own figures and saved as a draft in Sales › Collections, where a person reviews ' +
          'and sends it. Nothing is sent to the customer by this tool.',
        permissions: [PERMISSIONS.AI_COLLECTIONS_ACT, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW],
        feature: 'ai_collections',
        inputSchema: s.object({
          invoice_id: s.string('Invoice id, from collections_worklist or list_invoices'),
          tone: s.nullable(s.enum(MESSAGE_TONES, 'Default: the tone the worklist suggests, else formal')),
        }),
        propose: async (ctx, input) => {
          const invoice = await this.collections.openInvoice(ctx.organizationId, ctx.user.id, String(input['invoice_id'] ?? ''));
          const tone = opt<MessageTone>(input, 'tone') ?? 'formal';
          return {
            summary: `Payment reminder for invoice ${invoice.fiscalNumber ?? invoice.invoiceNumber} (${tone})`,
            preview: {
              invoice: invoice.fiscalNumber ?? invoice.invoiceNumber,
              customer: invoice.customer?.companyName ?? invoice.customerName,
              to: invoice.customer?.email ?? null,
              balance: invoice.balance,
              currency: invoice.currencyCode,
              dueDate: invoice.dueDate,
              tone,
            },
          };
        },
        commit: async (ctx, input) => {
          const invoice = await this.collections.openInvoice(ctx.organizationId, ctx.user.id, String(input['invoice_id'] ?? ''));
          const tone = opt<MessageTone>(input, 'tone') ?? 'formal';
          const { message } = await this.collections.composeReminder(ctx.organizationId, { id: ctx.user.id }, invoice.id, tone);
          const draft = await this.collections.saveDraft(ctx.organizationId, ctx.user.id, invoice.id, { tone, message });
          // The draft opens in the worklist, where the person reviews and sends it.
          return { id: draft.id, link: `/collections?draft=${draft.id}`, label: invoice.fiscalNumber ?? invoice.invoiceNumber };
        },
      },
    );
  }
}
