import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  interpolate,
  WorkflowAction,
  WorkflowActionContext,
  WorkflowActionRegistry,
  WorkflowActionResult,
} from '../workflow-engine/contracts/workflow-actions';
import { MESSAGE_TONES, MessageTone } from '../invoices/dto/compose-invoice-message.dto';
import { CollectionsService } from './collections.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Payment reminder» as an automatic workflow step, for a company that wants reminders to go out
 * on a rule (an invoice 15 days overdue, say), usually behind an approval step in the same process.
 *
 * `draft` (the default) leaves the reminder in Sales › Collections for a person to send; `send`
 * sends it. Either way the note is written by the assistant when it is available — from the
 * invoice's own figures — and the e-mail states the balance and due date itself when it is not.
 */
@Injectable()
export class CollectionsWorkflowActions implements OnModuleInit {
  private readonly logger = new Logger(CollectionsWorkflowActions.name);

  constructor(
    private readonly registry: WorkflowActionRegistry,
    private readonly collections: CollectionsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.paymentReminder());
  }

  private paymentReminder(): WorkflowAction {
    return {
      key: 'payment_reminder',
      labelKey: 'workflow_engine.action.payment_reminder',
      descriptionKey: 'workflow_engine.action_help.payment_reminder',
      outcomes: ['sent', 'drafted', 'skipped'],
      params: [
        { name: 'invoiceId', labelKey: 'workflow_engine.param.invoice_id', type: 'string', required: true, templated: true, maxLength: 200, hintKey: 'workflow_engine.param.invoice_id_hint' },
        { name: 'tone', labelKey: 'workflow_engine.param.tone', type: 'select', options: [...MESSAGE_TONES] },
        { name: 'mode', labelKey: 'workflow_engine.param.reminder_mode', type: 'select', options: ['draft', 'send'] },
      ],
      run: async (ctx: WorkflowActionContext): Promise<WorkflowActionResult> => {
        const invoiceId = interpolate(String(ctx.params['invoiceId'] ?? ''), ctx.context).trim();
        if (!UUID.test(invoiceId)) return { outcome: 'skipped', summary: `No invoice id («${invoiceId.slice(0, 60)}»).` };
        const tone = (MESSAGE_TONES as readonly string[]).includes(String(ctx.params['tone'])) ? (ctx.params['tone'] as MessageTone) : 'formal';
        const mode = ctx.params['mode'] === 'send' ? 'send' : 'draft';

        let invoice;
        try {
          // The process runs as nobody in particular: no branch scope, the company's own invoices.
          invoice = await this.collections.openInvoice(ctx.organizationId, null, invoiceId);
        } catch {
          return { outcome: 'skipped', summary: 'The invoice is not open any more.' };
        }

        let message: string | null = null;
        try {
          message = (await this.collections.composeReminder(ctx.organizationId, { id: null }, invoice.id, tone)).message;
        } catch (error) {
          // Without the assistant the reminder still goes out: the template states the figures.
          this.logger.warn(`Recordatorio sin nota redactada (${invoice.id}): ${(error as Error).message}`);
        }

        const number = invoice.fiscalNumber ?? invoice.invoiceNumber;
        if (mode === 'draft') {
          await this.collections.saveDraft(ctx.organizationId, ctx.startedByUserId, invoice.id, { tone, message });
          return { outcome: 'drafted', patch: { reminderInvoice: number }, summary: `Reminder for ${number} drafted for review.` };
        }
        if (!invoice.customer?.email) return { outcome: 'skipped', summary: `${number}: the customer has no e-mail.` };
        const sent = await this.collections.sendReminder(ctx.organizationId, { id: ctx.startedByUserId }, invoice.id, { message, tone });
        return { outcome: 'sent', patch: { reminderInvoice: number, reminderSentTo: sent.to }, summary: `Reminder for ${number} sent to ${sent.to}.` };
      },
    };
  }
}
