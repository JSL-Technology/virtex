import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InvoiceStatus, InvoiceType } from '../invoices/entities/invoice.entity';
import {
  REMINDER_STEP_GRACE_DAYS,
  reminderStepFor,
  reminderToneFor,
} from '../contracts/collections/reminder-schedule.contract';
import { RECENT_CONTACT_DAYS } from './collection-priority';
import { CollectionActivity } from './entities/collection-activity.entity';
import { CollectionsService, customerAddresses, daysBetween, emptyHistory, toIsoDate } from './collections.service';

/** What one run of the schedule did for one company. */
export interface AutomaticRemindersRun {
  sent: number;
  /** Waiting for a reason that may pass within the step's grace: a promise in date, a recent contact. */
  postponed: number;
  /** Not sent and not going to be on this step: disputed, or no address on the customer. */
  skipped: number;
  /** Sending was attempted and failed; the step was released and is tried again on the next run. */
  failed: number;
}

/** A company has at most this many reminders sent in one run; the rest go on the next. */
export const MAX_REMINDERS_PER_RUN = 200;

/**
 * Payment reminders that go out on their own, on the company's schedule (TES-13).
 *
 * Collections had reminders a person wrote and sent, and nothing else: every plan, every company,
 * chased every invoice by hand — where the products it is compared with send them by themselves as
 * part of the entry tier. Now a company that turns the schedule on has each open invoice reminded on
 * the days it chose, counted from the due date.
 *
 * ## What it will not do
 *
 * - Send a step twice, or a step after a later one. The step is claimed in `collection_activities`
 *   before the e-mail is queued, under a unique index on (invoice, step), so two runs — two replicas,
 *   a retried night — cannot both send it, and the mail job is named after the claim so a retried
 *   hand-off is not queued twice.
 * - Remind a customer that promised to pay by a date that has not passed, that someone called or
 *   reminded in the last {@link RECENT_CONTACT_DAYS} days, or whose last call ended with the invoice
 *   disputed. The first two wait (the step is still sent within its grace); a dispute is a person's.
 * - Remind a customer the company took out of the schedule (`customers.automatic_reminders`).
 * - Write the note with the assistant. The template states the balance and the due date; nobody
 *   reads a scheduled reminder before it leaves, so nothing in it is generated.
 */
@Injectable()
export class AutomaticRemindersService {
  private readonly logger = new Logger(AutomaticRemindersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly collections: CollectionsService,
    @InjectRepository(CollectionActivity) private readonly activities: Repository<CollectionActivity>,
  ) {}

  /** The company's schedule, or null when it has not turned it on. */
  async scheduleOf(organizationId: string): Promise<number[] | null> {
    const [row] = await this.dataSource.query(
      `SELECT collections_automatic_reminders AS enabled, collections_reminder_days AS days
         FROM organization_settings WHERE organization_id = $1`,
      [organizationId],
    );
    if (!row?.enabled) return null;
    const days = (row.days as number[] | null) ?? [];
    return days.length ? days.map(Number) : null;
  }

  /** Send what the schedule has due today for one company. Idempotent: a second run sends nothing new. */
  async run(organizationId: string, today: string): Promise<AutomaticRemindersRun> {
    const result: AutomaticRemindersRun = { sent: 0, postponed: 0, skipped: 0, failed: 0 };
    const days = await this.scheduleOf(organizationId);
    if (!days) return result;

    // Only invoices whose age is inside some step's window: before the first step nothing is due,
    // and past the last step's grace nothing more goes out on its own.
    const earliest = Math.min(...days);
    const latest = Math.max(...days) + REMINDER_STEP_GRACE_DAYS - 1;
    const candidates: Array<{ id: string; due: string | Date }> = await this.dataSource.query(
      `SELECT i.id, COALESCE(i."dueDate", i."issueDate") AS due
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
        WHERE i.organization_id = $1
          AND i.status::text = ANY($2::text[])
          AND i.type::text = ANY($3::text[])
          AND i.balance > 0
          AND c.automatic_reminders = true
          AND ($4::date - COALESCE(i."dueDate", i."issueDate")) BETWEEN $5 AND $6
        ORDER BY COALESCE(i."dueDate", i."issueDate") ASC, i.id ASC`,
      [
        organizationId,
        [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID],
        [InvoiceType.INVOICE, InvoiceType.DEBIT_NOTE],
        today,
        earliest,
        latest,
      ],
    );
    if (candidates.length === 0) return result;

    const history = await this.collections.historyFor(
      organizationId,
      candidates.map((candidate) => candidate.id),
      today,
    );

    for (const candidate of candidates) {
      if (result.sent >= MAX_REMINDERS_PER_RUN) break;
      const daysOverdue = daysBetween(toIsoDate(candidate.due), today);
      const step = reminderStepFor(days, daysOverdue);
      if (step === null) continue;

      const past = history.get(candidate.id) ?? emptyHistory();
      if (past.lastScheduleStep !== null && past.lastScheduleStep >= step) continue;
      if (past.lastCallOutcome === 'disputed') {
        result.skipped += 1;
        continue;
      }
      const sinceContact = past.lastPersonContactAt ? daysBetween(toIsoDate(past.lastPersonContactAt), today) : null;
      if (past.openPromise || (sinceContact !== null && sinceContact < RECENT_CONTACT_DAYS)) {
        result.postponed += 1;
        continue;
      }

      const outcome = await this.send(organizationId, candidate.id, step, daysOverdue);
      result[outcome] += 1;
    }

    if (result.sent || result.failed) {
      this.logger.log(
        { event: 'collections_automatic_reminders', organizationId, today, ...result },
        `Recordatorios automáticos de ${organizationId}: ${result.sent} enviados, ${result.failed} fallidos.`,
      );
    }
    return result;
  }

  /**
   * Claim the step, then queue the e-mail; release the claim when the e-mail could not be queued, so
   * the next run tries the step again rather than recording a reminder that never left.
   */
  private async send(
    organizationId: string,
    invoiceId: string,
    step: number,
    daysOverdue: number,
  ): Promise<'sent' | 'skipped' | 'failed'> {
    // The person-free path: no branch scope, the company's own invoice, still owed.
    const invoice = await this.collections.openInvoice(organizationId, null, invoiceId).catch(() => null);
    if (!invoice) return 'skipped';
    const to = customerAddresses(invoice)[0];
    if (!to) return 'skipped';

    const claimed = await this.activities
      .createQueryBuilder()
      .insert()
      .into(CollectionActivity)
      .values({
        organizationId,
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        kind: 'REMINDER',
        status: 'DONE',
        channel: 'email',
        userId: null,
        recipient: to,
        message: null,
        tone: reminderToneFor(daysOverdue),
        scheduleStep: step,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const activityId = (claimed.raw as Array<{ id: string }>)[0]?.id;
    // Someone else's run claimed it first: it is theirs to send.
    if (!activityId) return 'skipped';

    try {
      await this.collections.deliverReminder(organizationId, invoice, {
        to,
        message: null,
        jobId: `collection-reminder-${activityId}`,
      });
      return 'sent';
    } catch (error) {
      await this.activities.delete({ id: activityId, organizationId });
      this.logger.warn(
        `Recordatorio automático de ${invoice.id} (día ${step}) no se pudo poner en cola: ${(error as Error).message}`,
      );
      return 'failed';
    }
  }
}
