import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AiAssistPort } from '../contracts/ai/ai-assist.contract';
import { PaymentLikelihoodRegistry } from '../contracts/ai/payment-likelihood.contract';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../i18n/localized.exception';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoiceRendererService } from '../invoices/services/invoice-renderer.service';
import { MessageTone } from '../invoices/dto/compose-invoice-message.dto';
import { MailService } from '../mail/mail.service';
import { applyBranchScope, assertDocumentInScope, loadBranchScope } from '../organizations/contracts/branch.contract';
import { organizationBaseCurrency } from '../organizations/contracts/base-currency.contract';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { convert, roundAmount, toCents } from '../common/money';
import { CollectionAction, CollectionReason, rankCollection, TONE_FOR_ACTION } from './collection-priority';
import { CollectionActivity } from './entities/collection-activity.entity';
import { CollectionsWorklistQueryDto, LogCollectionActivityDto } from './dto/collections.dto';

export interface CollectionsWorklistItem {
  invoiceId: string;
  number: string;
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  currencyCode: string;
  balance: number;
  /** In the base currency, at the invoice's own rate: what the ranking weighs. */
  balanceBase: number;
  pBy7: number | null;
  pBy30: number;
  expectedDate: string | null;
  likelihoodSource: 'projection' | 'age';
  doubtful: boolean;
  priority: number;
  action: CollectionAction;
  suggestedTone: MessageTone | null;
  reasons: CollectionReason[];
  lastContact: { kind: string; occurredAt: Date; outcome: string | null } | null;
  openPromise: { date: string; amount: number | null } | null;
  brokenPromises: number;
  draftReminderId: string | null;
}

export interface CollectionsWorklist {
  asOfDate: string;
  baseCurrency: string;
  /** When the projection the likelihoods come from was computed; null: ranked by age alone. */
  projectionAt: Date | null;
  totals: { invoices: number; balanceBase: number; overdueBase: number; byAction: Record<string, number> };
  total: number;
  items: CollectionsWorklistItem[];
}

/** A promise is broken the day after its date passes with the invoice still open. */
const PROMISE_GRACE_DAYS = 1;

/**
 * Collections: who to chase, what was done, and the reminder itself.
 *
 * The worklist ranks every open invoice the person may see (their branches) by `rankCollection`,
 * from the balance, how overdue it is, how likely it is to arrive on its own (the cash-flow
 * projection, through `PaymentLikelihoodRegistry`), and what collections has already done — a
 * promise broken, a promise in date, a reminder sent yesterday.
 *
 * A reminder is always seen by a person before it leaves. It can be drafted (by the person, or by
 * the assistant through the copilot or a workflow), and is sent from here: by e-mail, from the
 * company's identity, in the invoice's language, with the invoice attached. The assistant writes
 * the note only; the figures in it are checked against the invoice and the template states them
 * itself.
 */
@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CollectionActivity) private readonly activities: Repository<CollectionActivity>,
    private readonly invoices: InvoicesService,
    private readonly renderer: InvoiceRendererService,
    private readonly mail: MailService,
    private readonly likelihood: PaymentLikelihoodRegistry,
    private readonly ai: AiAssistPort,
  ) {}

  // ── the worklist ─────────────────────────────────────────────────────────

  async worklist(organizationId: string, actorUserId: string | null, query: CollectionsWorklistQueryDto = {}): Promise<CollectionsWorklist> {
    const manager = this.dataSource.manager;
    const [asOfDate, baseCurrency] = await Promise.all([
      organizationToday(manager, organizationId),
      organizationBaseCurrency(manager, organizationId),
    ]);

    const qb = this.dataSource
      .getRepository(Invoice)
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.customer', 'customer')
      .where('invoice.organizationId = :organizationId', { organizationId })
      .andWhere('invoice.status IN (:...statuses)', { statuses: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID] })
      .andWhere('invoice.balance > 0');
    if (query.customerId) qb.andWhere('invoice.customerId = :customerId', { customerId: query.customerId });
    if (actorUserId || query.branchId) {
      applyBranchScope(qb, 'invoice', await loadBranchScope(manager, organizationId, actorUserId), query.branchId ?? null);
    }
    const open = await qb.getMany();

    const ids = open.map((invoice) => invoice.id);
    const [snapshot, history] = await Promise.all([
      this.likelihood.forInvoices(organizationId, ids),
      this.historyFor(organizationId, ids, asOfDate),
    ]);

    const balances = open.map((invoice) => this.baseAmount(invoice, baseCurrency)).sort((a, b) => a - b);
    // "Large" is relative to this book: the top tenth of balances.
    const largeBalance = balances.length >= 10 ? balances[Math.floor(balances.length * 0.9)] : Number.POSITIVE_INFINITY;

    const items = open.map((invoice): CollectionsWorklistItem => {
      const balanceBase = this.baseAmount(invoice, baseCurrency);
      const daysOverdue = daysBetween(invoice.dueDate ?? invoice.issueDate, asOfDate);
      const odds = snapshot.byInvoice.get(invoice.id) ?? null;
      const past = history.get(invoice.id) ?? emptyHistory();
      const ranking = rankCollection(
        {
          balanceBase,
          daysOverdue,
          pBy7: odds?.pBy7 ?? null,
          pBy30: odds?.pBy30 ?? null,
          doubtful: odds?.doubtful ?? false,
          brokenPromises: past.brokenPromises,
          openPromiseDate: past.openPromise?.date ?? null,
          daysSinceContact: past.lastContact ? daysBetween(toIsoDate(past.lastContact.occurredAt), asOfDate) : null,
        },
        largeBalance,
      );
      return {
        invoiceId: invoice.id,
        number: invoice.fiscalNumber ?? invoice.invoiceNumber,
        customerId: invoice.customerId,
        customerName: invoice.customer?.companyName ?? invoice.customerName,
        email: invoice.customer?.email ?? null,
        phone: invoice.customer?.phone || null,
        issueDate: toIsoDate(invoice.issueDate),
        dueDate: toIsoDate(invoice.dueDate ?? invoice.issueDate),
        daysOverdue,
        currencyCode: invoice.currencyCode ?? baseCurrency,
        balance: roundAmount(Number(invoice.balance)),
        balanceBase,
        pBy7: odds?.pBy7 ?? null,
        pBy30: ranking.pBy30,
        expectedDate: odds?.expectedDate ?? null,
        likelihoodSource: ranking.likelihoodSource,
        doubtful: odds?.doubtful ?? false,
        priority: ranking.priority,
        action: ranking.action,
        suggestedTone: TONE_FOR_ACTION[ranking.action] ?? null,
        reasons: ranking.reasons,
        lastContact: past.lastContact,
        openPromise: past.openPromise,
        brokenPromises: past.brokenPromises,
        draftReminderId: past.draftReminderId,
      };
    });

    const byAction: Record<string, number> = {};
    for (const item of items) byAction[item.action] = (byAction[item.action] ?? 0) + 1;
    const filtered = items
      .filter((item) => !query.action || item.action === query.action)
      .filter((item) => query.minDaysOverdue === undefined || item.daysOverdue >= query.minDaysOverdue)
      .sort((a, b) => b.priority - a.priority || b.daysOverdue - a.daysOverdue || b.balanceBase - a.balanceBase);

    const offset = Math.max(query.offset ?? 0, 0);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    return {
      asOfDate,
      baseCurrency,
      projectionAt: snapshot.computedAt,
      totals: {
        invoices: items.length,
        balanceBase: roundAmount(items.reduce((sum, item) => sum + item.balanceBase, 0)),
        overdueBase: roundAmount(items.filter((item) => item.daysOverdue > 0).reduce((sum, item) => sum + item.balanceBase, 0)),
        byAction,
      },
      total: filtered.length,
      items: filtered.slice(offset, offset + limit),
    };
  }

  // ── activities ───────────────────────────────────────────────────────────

  /** What was done on one invoice, newest first, with who did it. */
  async activitiesForInvoice(organizationId: string, actorUserId: string | null, invoiceId: string) {
    await this.openInvoice(organizationId, actorUserId, invoiceId, { allowSettled: true });
    return this.withAuthors(
      await this.activities.find({
        where: { organizationId, invoiceId },
        order: { occurredAt: 'DESC' },
        take: 200,
      }),
    );
  }

  /** Everything done with a customer, across their invoices, newest first. */
  async activitiesForCustomer(organizationId: string, customerId: string) {
    return this.withAuthors(
      await this.activities.find({
        where: { organizationId, customerId },
        order: { occurredAt: 'DESC' },
        take: 200,
      }),
    );
  }

  /** Record a call, a promise or a note. A call that ends in a promise records the promise too. */
  async log(organizationId: string, userId: string, dto: LogCollectionActivityDto): Promise<CollectionActivity[]> {
    const invoice = await this.openInvoice(organizationId, userId, dto.invoiceId);
    if (dto.kind === 'PROMISE' && !dto.promisedDate) throw new BadRequestError('collections.promise_needs_date');
    if (dto.promisedDate) {
      const today = await organizationToday(this.dataSource.manager, organizationId);
      if (dto.promisedDate < today) throw new BadRequestError('collections.promise_in_the_past');
    }
    if (dto.promisedAmount !== undefined && toCents(dto.promisedAmount) > toCents(invoice.balance)) {
      throw new BadRequestError('collections.promise_exceeds_balance', { balance: String(invoice.balance) });
    }
    const common = { organizationId, customerId: invoice.customerId, invoiceId: invoice.id, userId, status: 'DONE' as const };
    const rows: Array<Partial<CollectionActivity>> = [
      {
        ...common,
        kind: dto.kind,
        channel: dto.channel ?? (dto.kind === 'CALL' ? 'phone' : null),
        outcome: dto.kind === 'CALL' ? (dto.outcome ?? (dto.promisedDate ? 'promised' : null)) : null,
        promisedDate: dto.kind === 'PROMISE' ? (dto.promisedDate ?? null) : null,
        promisedAmount: dto.kind === 'PROMISE' ? (dto.promisedAmount ?? null) : null,
        message: dto.message?.trim() || null,
      },
    ];
    if (dto.kind === 'CALL' && dto.promisedDate) {
      rows.push({ ...common, kind: 'PROMISE', channel: 'phone', promisedDate: dto.promisedDate, promisedAmount: dto.promisedAmount ?? null });
    }
    return this.activities.save(rows.map((row) => this.activities.create(row)));
  }

  // ── reminders ────────────────────────────────────────────────────────────

  /**
   * A reminder note in the invoice's language and the tone asked for. The figures are the
   * invoice's, given to the model as facts; an answer stating any other is refused by `compose`.
   */
  async composeReminder(organizationId: string, user: { id: string | null; firstName?: string | null }, invoiceId: string, tone: MessageTone) {
    if (!this.ai.available()) throw new ServiceUnavailableError('collections.ai_not_available');
    const invoice = await this.openInvoice(organizationId, user.id, invoiceId);
    const { context } = await this.invoices.renderContext(invoice.id, organizationId);
    const summary = this.renderer.emailSummary(context);
    const today = await organizationToday(this.dataSource.manager, organizationId);
    const daysOverdue = daysBetween(invoice.dueDate ?? invoice.issueDate, today);
    const promise = (await this.historyFor(organizationId, [invoice.id], today)).get(invoice.id)?.openPromise ?? null;
    const { value } = await this.ai.compose({
      feature: 'compose',
      organizationId,
      userId: user.id,
      system: REMINDER_SYSTEM,
      instructions: [
        REMINDER_TONES[tone],
        daysOverdue > 0
          ? 'The invoice is past its due date: say so plainly and ask when payment can be expected.'
          : 'The invoice is not yet due: this is a courteous heads-up, not a demand.',
        promise ? 'The customer promised to pay by the promised date: refer to that promise.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      facts: {
        invoiceNumber: invoice.fiscalNumber ?? invoice.invoiceNumber,
        customer: invoice.customer?.contactPerson?.trim() || invoice.customer?.companyName || null,
        company: context.organization.legalName,
        balance: summary.balance,
        total: summary.total,
        dueDate: summary.dueDate,
        daysOverdue: daysOverdue > 0 ? daysOverdue : null,
        promisedDate: promise?.date ?? null,
        sender: user.firstName ?? null,
      },
      language: summary.language ?? 'es',
    });
    return { message: value.body.slice(0, 2000), tone };
  }

  /** Keep a reminder for someone to review and send. One open draft per invoice: a new one replaces it. */
  async saveDraft(
    organizationId: string,
    userId: string | null,
    invoiceId: string,
    draft: { tone?: MessageTone | null; message?: string | null; to?: string | null },
  ): Promise<CollectionActivity> {
    const invoice = await this.openInvoice(organizationId, userId, invoiceId);
    return this.dataSource.transaction(async (manager) => {
      await manager.update(
        CollectionActivity,
        { organizationId, invoiceId: invoice.id, kind: 'REMINDER', status: 'DRAFT' },
        { status: 'CANCELLED' },
      );
      return manager.save(
        manager.create(CollectionActivity, {
          organizationId,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          kind: 'REMINDER',
          status: 'DRAFT',
          channel: 'email',
          userId,
          tone: draft.tone ?? null,
          message: draft.message?.trim().slice(0, 2000) || null,
          recipient: draft.to?.trim() || invoice.customer?.email || null,
        }),
      );
    });
  }

  async cancelDraft(organizationId: string, actorUserId: string, draftId: string): Promise<void> {
    const draft = await this.activities.findOne({ where: { id: draftId, organizationId, kind: 'REMINDER', status: 'DRAFT' } });
    if (!draft) throw new NotFoundError('collections.draft_not_found');
    if (draft.invoiceId) await this.openInvoice(organizationId, actorUserId, draft.invoiceId, { allowSettled: true });
    await this.activities.update({ id: draft.id, organizationId }, { status: 'CANCELLED' });
  }

  /**
   * Send the reminder: from the company's identity, to the customer's address (or the one given),
   * in the invoice's language, with the invoice attached — and record that it was sent.
   */
  async sendReminder(
    organizationId: string,
    sender: { id: string | null; email?: string | null },
    invoiceId: string,
    options: { to?: string | null; message?: string | null; tone?: MessageTone | null; draftId?: string | null; attachInvoice?: boolean },
  ): Promise<{ queued: true; to: string; activityId: string }> {
    const invoice = await this.openInvoice(organizationId, sender.id, invoiceId);
    let draft: CollectionActivity | null = null;
    if (options.draftId) {
      draft = await this.activities.findOne({
        where: { id: options.draftId, organizationId, invoiceId: invoice.id, kind: 'REMINDER', status: 'DRAFT' },
      });
      if (!draft) throw new NotFoundError('collections.draft_not_found');
    }
    const to = options.to?.trim() || draft?.recipient || invoice.customer?.email || null;
    if (!to) throw new BadRequestError('invoices.customer_has_no_email');
    const message = (options.message ?? draft?.message ?? '').trim().slice(0, 2000) || null;

    const { context } = await this.invoices.renderContext(invoice.id, organizationId);
    const summary = this.renderer.emailSummary(context);
    const today = await organizationToday(this.dataSource.manager, organizationId);
    let pdf: Buffer | null = null;
    if (options.attachInvoice !== false) {
      try {
        pdf = await this.renderer.renderPdf(context);
      } catch (error) {
        // The reminder states the figures itself; a renderer outage must not stop it.
        this.logger.warn(`Recordatorio de ${invoice.id} sin PDF adjunto: ${(error as Error).message}`);
      }
    }
    const identity = await this.invoices.senderIdentity(organizationId);
    await this.mail.sendPaymentReminder({
      identity: { senderName: identity.senderName, replyTo: identity.replyTo ?? sender.email ?? null, copyTo: identity.copyTo },
      to,
      language: summary.language,
      invoiceNumber: invoice.fiscalNumber ?? invoice.invoiceNumber,
      customerName: invoice.customer?.contactPerson?.trim() || invoice.customer?.companyName || '',
      companyName: context.organization.legalName,
      balance: summary.balance,
      dueDate: summary.dueDate,
      overdue: daysBetween(invoice.dueDate ?? invoice.issueDate, today) > 0,
      message,
      pdf,
    });

    const sent = draft
      ? Object.assign(draft, { status: 'DONE' as const, occurredAt: new Date(), recipient: to, message, userId: sender.id ?? draft.userId, tone: options.tone ?? draft.tone })
      : this.activities.create({
          organizationId,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          kind: 'REMINDER',
          status: 'DONE',
          channel: 'email',
          userId: sender.id,
          recipient: to,
          message,
          tone: options.tone ?? null,
        });
    const saved = await this.activities.save(sent);
    return { queued: true, to, activityId: saved.id };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** An invoice of this company, within the person's branches, still owed (unless told otherwise). */
  async openInvoice(
    organizationId: string,
    actorUserId: string | null,
    invoiceId: string,
    options: { allowSettled?: boolean } = {},
  ): Promise<Invoice> {
    const invoice = await this.dataSource.getRepository(Invoice).findOne({
      where: { id: invoiceId, organizationId },
      relations: ['customer'],
    });
    if (!invoice) throw new NotFoundError('collections.invoice_not_found');
    if (actorUserId) {
      assertDocumentInScope(await loadBranchScope(this.dataSource.manager, organizationId, actorUserId), invoice.branchId);
    }
    const owed =
      [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID].includes(invoice.status) && toCents(invoice.balance) > 0;
    if (!owed && !options.allowSettled) throw new BadRequestError('collections.invoice_not_open');
    return invoice;
  }

  private baseAmount(invoice: Invoice, baseCurrency: string): number {
    const currency = (invoice.currencyCode ?? baseCurrency).toUpperCase();
    return roundAmount(currency === baseCurrency ? Number(invoice.balance) : convert(invoice.balance, Number(invoice.exchangeRate) || 1));
  }

  /** Per invoice: last contact, open promise, broken promises and the open draft. */
  private async historyFor(organizationId: string, invoiceIds: string[], today: string) {
    const result = new Map<string, InvoiceHistory>();
    for (let start = 0; start < invoiceIds.length; start += 500) {
      const rows = await this.activities.find({
        where: { organizationId, invoiceId: In(invoiceIds.slice(start, start + 500)), status: In(['DONE', 'DRAFT']) },
        order: { occurredAt: 'ASC' },
      });
      for (const row of rows) {
        if (!row.invoiceId) continue;
        const entry = result.get(row.invoiceId) ?? emptyHistory();
        if (row.status === 'DRAFT') {
          entry.draftReminderId = row.id;
        } else if (row.kind !== 'NOTE') {
          entry.lastContact = { kind: row.kind, occurredAt: row.occurredAt, outcome: row.outcome };
          if (row.kind === 'PROMISE' && row.promisedDate) {
            if (daysBetween(row.promisedDate, today) > PROMISE_GRACE_DAYS) {
              entry.brokenPromises += 1;
              if (entry.openPromise?.date === row.promisedDate) entry.openPromise = null;
            } else {
              // The latest promise in date is the one that counts; an earlier one it replaced is
              // not "broken" because a new date was agreed.
              entry.openPromise = { date: row.promisedDate, amount: row.promisedAmount };
            }
          }
        }
        result.set(row.invoiceId, entry);
      }
    }
    return result;
  }

  private async withAuthors(rows: CollectionActivity[]) {
    const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (ids.length) {
      // Only ids this company's own activities name; a member's home organization may be another.
      const users: Array<{ id: string; firstName: string | null; lastName: string | null }> = await this.dataSource.query(
        `SELECT u."id", u."firstName", u."lastName" FROM "users" u WHERE u."id" = ANY($1::uuid[])`,
        [ids],
      );
      for (const user of users) names.set(user.id, [user.firstName, user.lastName].filter(Boolean).join(' '));
    }
    return rows.map((row) => ({ ...row, userName: row.userId ? (names.get(row.userId) ?? null) : null }));
  }
}

interface InvoiceHistory {
  lastContact: { kind: string; occurredAt: Date; outcome: string | null } | null;
  openPromise: { date: string; amount: number | null } | null;
  brokenPromises: number;
  draftReminderId: string | null;
}

function emptyHistory(): InvoiceHistory {
  return { lastContact: null, openPromise: null, brokenPromises: 0, draftReminderId: null };
}

function toIsoDate(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both ISO dates); positive when `to` is later. */
function daysBetween(from: string | Date, to: string): number {
  const a = Date.parse(`${toIsoDate(from)}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Stable, so it is served from the prompt cache; everything per-invoice travels as facts. */
const REMINDER_SYSTEM =
  'You write the personal note in the body of a payment reminder e-mail from a company to its customer. ' +
  'At most 700 characters, two short paragraphs at most, no greeting line (the template greets the customer), ' +
  'no signature beyond the sender\'s first name if given, and no threats, penalties or legal language. ' +
  'Mention the invoice number and the outstanding balance; mention the due date and how overdue it is when ' +
  'relevant. Invite the customer to reply if they have already paid or need to agree a date. Return an empty subject.';

const REMINDER_TONES: Record<MessageTone, string> = {
  cordial: 'Tone: warm and friendly, assuming good faith; a gentle reminder.',
  formal: 'Tone: formal and courteous, as in business correspondence.',
  firm: 'Tone: firm but respectful: clear about the amount owed and that payment is now expected, without threats.',
};
