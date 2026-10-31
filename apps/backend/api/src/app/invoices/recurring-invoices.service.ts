import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import {
  RecurringFrequency,
  RecurringInvoice,
  RecurringInvoiceLine,
  RecurringInvoiceRun,
  RecurringRunStatus,
  RecurringStatus,
} from './entities/recurring-invoice.entity';
import { Customer } from '../customers/entities/customer.entity';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { forEachTenant, runAsTenantJob } from '../shared/tenancy/tenant-job';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { isLocalizedError } from '../i18n/localized.exception';

/** Months between two issues, per frequency. */
const MONTHS: Record<RecurringFrequency, number> = {
  [RecurringFrequency.MONTHLY]: 1,
  [RecurringFrequency.BIMONTHLY]: 2,
  [RecurringFrequency.QUARTERLY]: 3,
  [RecurringFrequency.SEMIANNUAL]: 6,
  [RecurringFrequency.ANNUAL]: 12,
};

/** A template more than this many periods behind is caught up this far per run, not all at once. */
const MAX_CATCH_UP = 12;

export interface RecurringInvoiceInput {
  customerId: string;
  branchId?: string | null;
  name: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate?: string | null;
  paymentTermDays?: number;
  autoIssue?: boolean;
  currencyCode?: string | null;
  notes?: string | null;
  lines: RecurringInvoiceLine[];
}

/**
 * Invoices issued on a schedule: the monthly iguala of an accounting firm, a rent, a maintenance
 * contract — billed on their date without anybody remembering to.
 *
 * Every day the job looks for templates due and issues each one's invoice for that date. A run is
 * a row unique per template and date, written in the same transaction as the invoice, so a run
 * repeated by two instances, by hand, or after a crash cannot bill the same period twice; a failed
 * issue (no e-NCF range left, a customer without a tax id) is recorded on the template and retried
 * the next day rather than skipped.
 */
@Injectable()
export class RecurringInvoicesService {
  private readonly logger = new Logger(RecurringInvoicesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoices: InvoicesService,
    private readonly schedulerLock: SchedulerLockService,
  ) {}

  // ── Templates ──────────────────────────────────────────────────────────────

  async create(input: RecurringInvoiceInput, organizationId: string, actorUserId: string): Promise<RecurringInvoice> {
    this.assertInput(input);
    const repo = this.dataSource.getRepository(RecurringInvoice);
    const customer = await this.dataSource.getRepository(Customer).findOne({ where: { id: input.customerId, organizationId }, select: ['id'] });
    if (!customer) throw new NotFoundError('customers.customer_not_found');
    return repo.save(
      repo.create({
        organizationId,
        branchId: input.branchId ?? null,
        customerId: input.customerId,
        name: input.name.trim().slice(0, 160),
        frequency: input.frequency,
        startDate: input.startDate,
        nextRunDate: input.startDate,
        endDate: input.endDate ?? null,
        paymentTermDays: Math.max(0, Math.floor(input.paymentTermDays ?? 0)),
        autoIssue: input.autoIssue !== false,
        currencyCode: input.currencyCode?.toUpperCase() ?? null,
        lines: RecurringInvoicesService.cleanLines(input.lines),
        notes: input.notes?.trim() || null,
        status: RecurringStatus.ACTIVE,
        createdById: actorUserId,
      }),
    );
  }

  async update(organizationId: string, id: string, input: Partial<RecurringInvoiceInput>): Promise<RecurringInvoice> {
    const template = await this.get(organizationId, id);
    if (template.status === RecurringStatus.ENDED) throw new ConflictError('invoices.recurring.ended');
    const merged = { ...template, ...input } as RecurringInvoiceInput;
    this.assertInput(merged);
    Object.assign(template, {
      name: merged.name.trim().slice(0, 160),
      frequency: merged.frequency,
      endDate: merged.endDate ?? null,
      paymentTermDays: Math.max(0, Math.floor(merged.paymentTermDays ?? 0)),
      autoIssue: merged.autoIssue !== false,
      notes: merged.notes?.trim() || null,
      lines: RecurringInvoicesService.cleanLines(merged.lines),
    });
    // A start date moved before anything was issued moves the first issue with it.
    if (input.startDate && template.runCount === 0) {
      template.startDate = input.startDate;
      template.nextRunDate = input.startDate;
    }
    return this.dataSource.getRepository(RecurringInvoice).save(template);
  }

  list(organizationId: string): Promise<RecurringInvoice[]> {
    return this.dataSource.getRepository(RecurringInvoice).find({
      where: { organizationId },
      relations: ['customer'],
      order: { status: 'ASC', nextRunDate: 'ASC' },
      take: 500,
    });
  }

  async get(organizationId: string, id: string): Promise<RecurringInvoice> {
    const template = await this.dataSource.getRepository(RecurringInvoice).findOne({ where: { id, organizationId }, relations: ['customer'] });
    if (!template) throw new NotFoundError('invoices.recurring.not_found');
    return template;
  }

  runs(organizationId: string, id: string): Promise<RecurringInvoiceRun[]> {
    return this.dataSource.getRepository(RecurringInvoiceRun).find({
      where: { organizationId, recurringInvoiceId: id },
      order: { runDate: 'DESC' },
      take: 120,
    });
  }

  async setStatus(organizationId: string, id: string, status: RecurringStatus.ACTIVE | RecurringStatus.PAUSED | RecurringStatus.ENDED): Promise<RecurringInvoice> {
    const template = await this.get(organizationId, id);
    if (template.status === RecurringStatus.ENDED) throw new ConflictError('invoices.recurring.ended');
    template.status = status;
    if (status === RecurringStatus.ENDED) template.nextRunDate = null;
    // Resuming does not bill the paused periods: it resumes from today's next due date.
    if (status === RecurringStatus.ACTIVE && template.nextRunDate) {
      const today = await organizationToday(this.dataSource.manager, organizationId);
      let next = template.nextRunDate;
      while (next < today) next = RecurringInvoicesService.advance(template.startDate, next, template.frequency);
      template.nextRunDate = next;
    }
    return this.dataSource.getRepository(RecurringInvoice).save(template);
  }

  // ── Issuing ────────────────────────────────────────────────────────────────

  /** 06:30 in Santo Domingo, every day, once across all instances. */
  @Cron('30 10 * * *', { name: 'recurring-invoices' })
  async runDailyOnce(): Promise<void> {
    await this.schedulerLock.runOnce('recurring-invoices', new Date().toISOString().slice(0, 10), async () => {
      await forEachTenant(this.dataSource, (organizationId) => this.runDue(organizationId).then(() => undefined));
    });
  }

  /** Issue every invoice due today or earlier for one company. Returns how many were created. */
  async runDue(organizationId: string): Promise<number> {
    const today = await organizationToday(this.dataSource.manager, organizationId);
    const due = await this.dataSource.getRepository(RecurringInvoice).find({
      where: { organizationId, status: RecurringStatus.ACTIVE, nextRunDate: LessThanOrEqual(today) },
    });
    let created = 0;
    for (const template of due) {
      for (let i = 0; i < MAX_CATCH_UP && template.nextRunDate && template.nextRunDate <= today; i++) {
        const ok = await this.issueFor(template, template.nextRunDate);
        if (!ok) break; // Failed: retried tomorrow, from the same date.
        created++;
      }
    }
    return created;
  }

  /** Issue the next due invoice of one template now, whatever its date (the «Emitir ahora» button). */
  async runNow(organizationId: string, id: string): Promise<RecurringInvoiceRun> {
    const template = await this.get(organizationId, id);
    if (template.status !== RecurringStatus.ACTIVE || !template.nextRunDate) {
      throw new ConflictError('invoices.recurring.not_active');
    }
    const runDate = template.nextRunDate;
    await this.issueFor(template, runDate);
    const run = await this.dataSource.getRepository(RecurringInvoiceRun).findOne({ where: { recurringInvoiceId: id, runDate } });
    if (!run) throw new NotFoundError('invoices.recurring.not_found');
    return run;
  }

  /**
   * The invoice of one period. The run row and the invoice commit together; a run that already
   * exists for the date means the period was billed, and the template simply moves on.
   */
  private async issueFor(template: RecurringInvoice, runDate: string): Promise<boolean> {
    const organizationId = template.organizationId;
    let invoiceToDispatch: Awaited<ReturnType<InvoicesService['createWithin']>> | null = null;
    try {
      await this.dataSource.transaction(async (manager) => {
        const claimed: Array<{ id: string }> = await manager.query(
          `INSERT INTO "recurring_invoice_runs" ("organization_id", "recurring_invoice_id", "run_date", "status")
           VALUES ($1, $2, $3, 'CREATED')
           ON CONFLICT ("recurring_invoice_id", "run_date") DO NOTHING
           RETURNING "id"`,
          [organizationId, template.id, runDate],
        );
        if (claimed.length) {
          const dueDate = new Date(Date.parse(runDate) + template.paymentTermDays * 86_400_000).toISOString().slice(0, 10);
          const invoice = await this.invoices.createWithin(
            {
              customerId: template.customerId,
              branchId: template.branchId ?? undefined,
              issueDate: runDate,
              dueDate,
              currencyCode: template.currencyCode ?? undefined,
              notes: [template.name, RecurringInvoicesService.periodLabel(runDate, template.frequency), template.notes].filter(Boolean).join(' · '),
              issue: template.autoIssue,
              lineItems: template.lines.map((line) => ({
                productId: line.productId ?? undefined,
                description: line.description ?? undefined,
                quantity: Number(line.quantity),
                unitPrice: line.unitPrice ?? undefined,
                discountRate: line.discountRate ?? undefined,
              })),
            } as CreateInvoiceDto,
            organizationId,
            manager,
            { actorUserId: template.createdById },
          );
          await manager.query(`UPDATE "recurring_invoice_runs" SET "invoice_id" = $1 WHERE "id" = $2`, [invoice.id, claimed[0].id]);
          template.runCount += 1;
          template.lastInvoiceId = invoice.id;
          template.lastRunAt = new Date();
          invoiceToDispatch = invoice;
        }
        template.lastError = null;
        const next = RecurringInvoicesService.advance(template.startDate, runDate, template.frequency);
        if (template.endDate && next > template.endDate) {
          template.nextRunDate = null;
          template.status = RecurringStatus.ENDED;
        } else {
          template.nextRunDate = next;
        }
        await manager.save(RecurringInvoice, template);
      });
      if (invoiceToDispatch) this.invoices.dispatchIssued(invoiceToDispatch);
      return true;
    } catch (error) {
      const message = isLocalizedError(error) ? error.messageKey : (error as Error).message;
      this.logger.warn({ event: 'recurring_invoice_failed', organizationId, templateId: template.id, runDate, message }, 'Recurring invoice could not be issued');
      await runAsTenantJob(this.dataSource, organizationId, () =>
        this.dataSource.getRepository(RecurringInvoice).update({ id: template.id, organizationId }, { lastError: message.slice(0, 500) }),
      ).catch(() => undefined);
      return false;
    }
  }

  // ── The calendar ───────────────────────────────────────────────────────────

  /**
   * The issue after `from`: the start date's day of the month, one period later, clamped to the
   * month's last day — a template started on 31 January bills on 28/29 February and 31 March.
   */
  static advance(startDate: string, from: string, frequency: RecurringFrequency): string {
    const [, , startDay] = startDate.split('-').map(Number);
    const [y, m] = from.split('-').map(Number);
    const total = (y * 12 + (m - 1)) + MONTHS[frequency];
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(startDay, lastDay);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /** «Período 2026-10» (monthly) or «Período 2026-10 a 2026-12» — printed on the invoice. */
  static periodLabel(runDate: string, frequency: RecurringFrequency): string {
    const [y, m] = runDate.split('-').map(Number);
    const months = MONTHS[frequency];
    const endTotal = y * 12 + (m - 1) + months - 1;
    const end = `${Math.floor(endTotal / 12)}-${String((endTotal % 12) + 1).padStart(2, '0')}`;
    const start = runDate.slice(0, 7);
    return months === 1 ? `Período ${start}` : `Período ${start} a ${end}`;
  }

  private assertInput(input: RecurringInvoiceInput): void {
    if (!input.name?.trim()) throw new BadRequestError('invoices.recurring.name_required');
    if (!Object.values(RecurringFrequency).includes(input.frequency)) throw new BadRequestError('invoices.recurring.frequency_invalid');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate ?? '')) throw new BadRequestError('invoices.recurring.start_date_invalid');
    if (input.endDate && input.endDate < input.startDate) throw new BadRequestError('invoices.recurring.end_before_start');
    if (!input.lines?.length) throw new BadRequestError('invoices.recurring.no_lines');
    for (const line of input.lines) {
      if (!(Number(line.quantity) > 0)) throw new BadRequestError('invoices.recurring.quantity_positive');
      if (!line.productId && !line.description?.trim()) throw new BadRequestError('invoices.recurring.line_needs_product_or_description');
    }
  }

  private static cleanLines(lines: RecurringInvoiceLine[]): RecurringInvoiceLine[] {
    return lines.map((line) => ({
      productId: line.productId ?? null,
      description: line.description?.trim() || null,
      quantity: Number(line.quantity),
      unitPrice: line.unitPrice === null || line.unitPrice === undefined ? null : Number(line.unitPrice),
      discountRate: line.discountRate ? Number(line.discountRate) : null,
    }));
  }
}
