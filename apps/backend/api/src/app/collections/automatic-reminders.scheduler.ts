import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ExclusiveJob } from '../shared/scheduling/exclusive-job';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { forEachTenant } from '../shared/tenancy/tenant-job';
import { fiscalDate, localHour, organizationTimeZone } from '../shared/fiscal-clock';
import { inService } from '../saas/contracts/entitlements.contract';
import { AutomaticRemindersService } from './automatic-reminders.service';

const JOB = 'collections-automatic-reminders';
/** Reminders leave at the first run after this hour on the company's own clock. */
export const REMINDER_SEND_HOUR = 9;

/**
 * When the payment reminders go out: once a day per company, in its morning.
 *
 * A single daily time in UTC is the morning of one part of the world and the night of another, and a
 * company's customers read e-mail on the company's clock. So the job runs every hour and acts, for
 * each company in service, at the first run after {@link REMINDER_SEND_HOUR} in its own time zone;
 * the claim (`scheduled_job_runs`, keyed by company and local date) makes that once a day whichever
 * replica runs it, and a failed run releases the claim so the next hour retries.
 */
@Injectable()
export class AutomaticRemindersScheduler {
  private readonly logger = new Logger(AutomaticRemindersScheduler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly reminders: AutomaticRemindersService,
    private readonly schedulerLock: SchedulerLockService,
  ) {}

  @Cron('7 * * * *', { name: JOB })
  @ExclusiveJob()
  async handleCron(): Promise<void> {
    await this.runDue(new Date());
  }

  /** Run every company that is due at `at`, each in its own tenant context. */
  async runDue(at: Date): Promise<void> {
    const due = await this.companiesDue(at);
    // `forEachTenant` reads an empty list as «every company»: nothing due is nothing to run.
    if (due.length === 0) return;
    const todayOf = new Map(due.map((company) => [company.organizationId, company.today]));
    await forEachTenant(
      this.dataSource,
      async (organizationId) => {
        await this.runCompany(organizationId, todayOf.get(organizationId) as string);
      },
      due.map((company) => company.organizationId),
    );
  }

  /**
   * One company's reminders for its date `today`, claimed so that it happens once that day.
   * Returns whether this call ran them; a failure is logged and releases the claim.
   */
  async runCompany(organizationId: string, today: string): Promise<boolean> {
    return this.schedulerLock
      .runOnce(JOB, `${organizationId}:${today}`, async () => {
        await this.reminders.run(organizationId, today);
      })
      .catch((error) => {
        this.logger.error(`Recordatorios automáticos de ${organizationId} fallaron: ${(error as Error).message}`);
        return false;
      });
  }

  /**
   * Companies in service whose clock has passed the sending hour and whose run for their date has
   * not happened. Read in two queries rather than one transaction per company and hour.
   */
  async companiesDue(at: Date): Promise<Array<{ organizationId: string; today: string }>> {
    const organizations: Array<{
      id: string;
      country: string | null;
      timezone: string | null;
      subscription_status: string | null;
      grace_period_end: Date | null;
    }> = await this.dataSource.query(
      `SELECT id, country, timezone, subscription_status, grace_period_end FROM organizations`,
    );
    const ready = organizations
      .filter((organization) =>
        inService({ subscriptionStatus: organization.subscription_status, gracePeriodEnd: organization.grace_period_end }, at),
      )
      .map((organization) => {
        const zone = organizationTimeZone(organization);
        return { organizationId: organization.id, today: fiscalDate(zone, at), hour: localHour(zone, at) };
      })
      .filter((company) => company.hour >= REMINDER_SEND_HOUR);
    if (ready.length === 0) return [];

    const done: Array<{ run_key: string }> = await this.dataSource.query(
      `SELECT run_key FROM scheduled_job_runs WHERE job_name = $1 AND run_key = ANY($2::text[])`,
      [JOB, ready.map((company) => `${company.organizationId}:${company.today}`)],
    );
    const finished = new Set(done.map((row) => row.run_key));
    return ready
      .filter((company) => !finished.has(`${company.organizationId}:${company.today}`))
      .map(({ organizationId, today }) => ({ organizationId, today }));
  }
}
