import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { matchLanguage } from '@virteex/shared/types';
import { PERMISSIONS } from '../shared/permissions';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { forEachTenant } from '../shared/tenancy/tenant-job';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { NotificationsService } from './notifications.service';
import { membersWithPermission } from './recipients';
import { formatAmount } from './listeners/operations-notifications.listener';

const TITLE_KEY = 'notifications.overdue_invoices.title';
/** How far back a first digest looks, so a company does not get its whole history at once. */
const FIRST_LOOKBACK_DAYS = 7;

/**
 * Overdue invoices in the bell (QA R3-M09: «facturas vencidas» never reached anyone).
 *
 * Once a day, per company, the people who follow receivables get one notice when invoices have
 * fallen due since the previous one: how many and for how much, and what is overdue in all. A day
 * with nothing newly overdue sends nothing — a notice that repeats the same total every morning
 * stops being read. The claim is per company and calendar day, so two replicas send it once.
 */
@Injectable()
export class OverdueInvoicesNotifier {
  private readonly logger = new Logger(OverdueInvoicesNotifier.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly schedulerLock: SchedulerLockService,
  ) {}

  // 12:15 UTC: the morning in the Americas, where the receivables teams that read it work.
  @Cron('15 12 * * *', { name: 'overdue-invoices-digest' })
  async handleCron(): Promise<void> {
    await forEachTenant(this.dataSource, async (organizationId) => {
      const today = await organizationToday(this.dataSource.manager, organizationId);
      await this.schedulerLock
        .runOnce('overdue-invoices-digest', `${organizationId}:${today}`, async () => {
          await this.notify(organizationId, today);
        })
        .catch((error) => this.logger.error(`Overdue digest failed for ${organizationId}: ${(error as Error).message}`));
    });
  }

  /** Send the company's digest for `today`. Returns how many people received it. */
  async notify(organizationId: string, today: string): Promise<number> {
    const [last] = await this.dataSource.query(
      `SELECT max(n."createdAt")::date AS since FROM notification n
        WHERE n.organization_id = $1 AND n.title_key = $2`,
      [organizationId, TITLE_KEY],
    );
    const since: string =
      last?.since ? toIso(last.since) : shiftDays(today, -FIRST_LOOKBACK_DAYS);

    const [row] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE i."dueDate" >= $3::date)::int AS "newCount",
              coalesce(sum(${BASE_BALANCE}) FILTER (WHERE i."dueDate" >= $3::date), 0)::numeric AS "newAmount",
              count(*)::int AS "totalCount",
              coalesce(sum(${BASE_BALANCE}), 0)::numeric AS "totalAmount",
              (SELECT s.base_currency FROM organization_settings s WHERE s.organization_id = $1) AS currency
         FROM invoices i
        WHERE i.organization_id = $1
          AND i.status IN ('Pending', 'Partially Paid')
          AND i.type = 'INVOICE'
          AND i.balance > 0
          AND i."dueDate" < $2::date`,
      [organizationId, today, since],
    );
    if (!row || row.newCount === 0) return 0;

    const recipients = await membersWithPermission(this.dataSource, organizationId, PERMISSIONS.ACCOUNTS_RECEIVABLE_VIEW);
    for (const recipient of recipients) {
      const language = matchLanguage(recipient.language) ?? 'es';
      await this.notifications.createLocalizedNotification(recipient.id, language, {
        titleKey: TITLE_KEY,
        bodyKey: 'notifications.overdue_invoices.body',
        params: {
          count: row.newCount,
          amount: formatAmount(Number(row.newAmount), language, row.currency),
          totalCount: row.totalCount,
          totalAmount: formatAmount(Number(row.totalAmount), language, row.currency),
        },
        link: '/collections',
        organizationId,
      });
    }
    return recipients.length;
  }
}

/** The open balance in the books' currency: the invoice's own rate, as its total was converted. */
const BASE_BALANCE = `CASE WHEN i.total > 0 AND i.total_in_base_currency IS NOT NULL
  THEN i.balance * i.total_in_base_currency / i.total ELSE i.balance END`;

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
