import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  PendingRegistration,
  PendingRegistrationStatus,
} from '../entities/pending-registration.entity';

/**
 * Enforce the retention limit on abandoned signups.
 *
 * `pending_registrations` holds a first and last name, an email address, a phone number, a
 * national tax identifier, a complete fiscal address and an Argon2 password hash — for people who
 * started a signup and, in the great majority of cases, never finished it. `expires_at` was
 * written on every row and then read by nothing: no lookup consulted it, no job swept by it, so
 * the personal data of non-customers accumulated permanently and the table grew without bound.
 *
 * Under the GDPR (Art. 5(1)(e)), Brazil's LGPD (Art. 16) and the Dominican Republic's Ley 172-13,
 * personal data may be kept only as long as the purpose requires. The purpose here is completing
 * one checkout; once the window closes, the purpose is gone.
 *
 * Three states, three different answers, because they are three different obligations:
 *
 *   - `pending` past its expiry — the signup was abandoned. Delete it outright.
 *   - `completed` — the account exists and holds this data itself. The pending row is a duplicate
 *     copy of personal data with no remaining purpose, so it is deleted after a short grace
 *     period that leaves the webhook/redirect race no chance to lose a paid signup.
 *   - `failed` — the customer WAS charged. This row is the only record of that, so it is kept
 *     until an operator resolves it and is never swept.
 */
@Injectable()
export class PendingRegistrationCleanupService {
  private readonly logger = new Logger(PendingRegistrationCleanupService.name);

  /**
   * How long a completed row survives after the account exists.
   *
   * Not zero: `completePendingRegistration` is reached from both the Stripe webhook and the
   * browser redirect, and they race. Deleting the row the instant the account is created would
   * make the loser of that race fail to find it and report a signup that in fact succeeded.
   */
  private static readonly COMPLETED_GRACE_MS = 24 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(PendingRegistration)
    private readonly repository: Repository<PendingRegistration>,
  ) {}

  /**
   * Hourly rather than nightly. The window a pending registration is redeemable for is measured
   * in hours, so a daily sweep would leave abandoned personal data lying around for most of a day
   * after it stopped serving any purpose.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    const now = new Date();

    const abandoned = await this.repository.delete({
      status: PendingRegistrationStatus.PENDING,
      expiresAt: LessThan(now),
    });

    const settled = await this.repository.delete({
      status: PendingRegistrationStatus.COMPLETED,
      createdAt: LessThan(new Date(now.getTime() - PendingRegistrationCleanupService.COMPLETED_GRACE_MS)),
    });

    const removed = (abandoned.affected ?? 0) + (settled.affected ?? 0);
    if (removed > 0) {
      this.logger.log(
        { event: 'pending_registrations_purged', abandoned: abandoned.affected ?? 0, settled: settled.affected ?? 0 },
        `Purged ${removed} pending registration(s) whose personal data no longer serves a purpose.`,
      );
    }

    // Paid signups that could not be materialised are never swept — they are somebody's money.
    // Surfacing the backlog is how it stops being invisible.
    const stranded = await this.repository.count({
      where: { status: PendingRegistrationStatus.FAILED },
    });
    if (stranded > 0) {
      this.logger.warn(
        { event: 'registrations_awaiting_resolution', count: stranded },
        `${stranded} paid registration(s) failed to materialise and are awaiting manual resolution.`,
      );
    }
  }
}
