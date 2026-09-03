import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AfterCommitService } from '../../shared/after-commit/after-commit.service';
import { MailService } from '../../mail/mail.service';
import { UserRegisteredEvent } from '../events/user-registered.event';

/**
 * The welcome email.
 *
 * ## Why a listener and not a line in `RegistrationService`
 *
 * Sending it inline would put it on the critical path of a paid signup: the person has already
 * been charged, and a mail failure at that point must not decide whether the account exists.
 * Registration already emits `user.registered` as its integration point, and greeting somebody is
 * exactly that — something that happens *because* a tenant was created, not something the tenant
 * needs in order to exist.
 *
 * ## Why `runAfterCommit`
 *
 * The event fires INSIDE the transaction that materialises the account. Enqueueing from there
 * means the mail worker — a separate process on a separate connection — can pick the job up
 * before the `COMMIT` lands, or after a `ROLLBACK` that means the account never existed. Either
 * way the customer is welcomed to nothing. `AfterCommitService` parks the send until the
 * transaction is durably committed and drops it if it is not.
 *
 * ## Why only a new identity
 *
 * An existing customer registering their second company is not a new customer. They get
 * `organization-added`, which tells them what actually changed; welcoming them to a product they
 * have used for a year reads as a system that does not know who they are.
 *
 * ## Why the failure is swallowed
 *
 * A welcome is a courtesy. `MailService` enqueues rather than sends, so the only thing that can
 * throw here is the queue itself being unreachable — and the account is already committed and
 * usable at that point. Turning a Redis blip into a failed registration response would be a worse
 * outcome than a missing greeting, so it is logged and left.
 */
@Injectable()
export class WelcomeEmailListener {
  private readonly logger = new Logger(WelcomeEmailListener.name);

  constructor(
    private readonly mailService: MailService,
    private readonly afterCommit: AfterCommitService,
  ) {}

  @OnEvent('user.registered')
  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    if (!event.isNewIdentity) return;

    await this.afterCommit.runAfterCommit(
      event.entityManager,
      `welcome email for organization ${event.organization.id}`,
      async () => {
        try {
          await this.mailService.sendWelcomeEmail(
            event.user,
            event.organization.legalName,
          );
        } catch (error) {
          this.logger.warn(
            {
              event: 'welcome_email_not_queued',
              organizationId: event.organization.id,
            },
            `Could not queue the welcome email: ${(error as Error).message}`,
          );
        }
      },
    );
  }
}
