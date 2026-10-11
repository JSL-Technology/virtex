import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccountingPeriod, ModuleSlug } from '../entities/accounting-period.entity';
import { AccountPeriodLock } from '../entities/account-period-lock.entity';
import { ForbiddenError } from '../../i18n/localized.exception';
import { resolvePostingPeriod } from '../period-status';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';

/**
 * Refuses a request whose document date falls in a closed period or touches a locked account.
 *
 * ## Why the guard exists at all when the service checks too
 *
 * The service is the authority — `resolvePostingPeriod` runs inside the posting transaction, and
 * nothing reaches the ledger without it. The guard is a fast, early rejection so a large document
 * is not validated, priced and half-built before being refused. Both call the same function now;
 * they used to check different things, and the guard's version was the weaker of the two.
 *
 * ## Two defects this replaces
 *
 * It returned `true` when the tenant had no accounting periods at all. That is a fail-open: an
 * organization whose calendar was never created could post to any date, forever, and the condition
 * is invisible because everything works. Provisioning creates periods, so the only tenants in that
 * state are ones where provisioning did not finish — exactly the ones that should be stopped.
 *
 * And when it *did* find a locked account, it built the error message from
 * `lockedAccount.account.code` after an `innerJoin` with no `select`. TypeORM does not hydrate a
 * relation joined that way, so the property was undefined and the guard threw a `TypeError`: the
 * user got a 500 instead of the 403 explaining which account was locked.
 */
@Injectable()
export class PeriodLockGuard implements CanActivate {
  constructor(
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    @InjectRepository(AccountPeriodLock)
    private readonly lockRepo: Repository<AccountPeriodLock>,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { body, user } = request;

    if (!user?.organizationId) return true;

    // `openingDate` is here because opening a bank account with a declared balance posts a real
    // journal entry on that date. Without it the guard silently passed every such request through
    // to the service, which does enforce the lock inside the transaction — a correct rejection,
    // but one that arrives after the account row has been built.
    const transactionDateStr =
      body?.date ?? body?.issueDate ?? body?.paymentDate ?? body?.openingDate;
    if (!transactionDateStr) return true;

    const transactionDate = new Date(`${String(transactionDateStr).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(transactionDate.getTime())) return true;

    const organizationId: string = user.organizationId;

    // Always the general ledger, never `body.accountingModule`.
    //
    // Guards run BEFORE the `ValidationPipe`, so `whitelist: true` has not stripped anything yet
    // and the body is entirely caller-controlled. Reading the subledger from it let a request
    // choose which period window it would be judged against: with accounts payable closed for
    // March, `{"accountingModule": "GL"}` on a March supplier invoice passed the guard. Which
    // subledger a posting belongs to is a server-side fact, decided by the service that posts it
    // and carried in `PostingContext.module`; the service enforces it inside the transaction.
    //
    // Every posting reaches the general ledger, so checking GL here is a real early rejection and
    // not a weaker one — it simply is not the whole check, and was never meant to be.
    // `createIfMissing` so the guard and the service agree: the service opens the fiscal year a
    // posting needs, and a guard that rejected the very date the service would accept would be a
    // false wall. This guard only fronts state-changing posting routes, so opening the calendar
    // here is the same idempotent write the service would do a moment later, just earlier.
    // Under its own tenant connection, because a guard has none.
    //
    // `TenantConnectionInterceptor` is an `APP_INTERCEPTOR`, and in Nest every interceptor runs
    // AFTER every guard — so `app.current_organization` is not set on any pooled connection yet
    // when this runs. Left to the default manager, the period read returned nothing (the row-level
    // policies hide every row without a tenant), the guard then took `createIfMissing` to be true
    // and tried to open a fiscal year the tenant already had, and the INSERT was refused with «new
    // row violates row-level security policy for table "fiscal_years"» — a 500 on the first invoice
    // of a perfectly provisioned company. The same shape a background job faces, solved the same
    // way (see `extension-scope.guard.ts`): establish the tenant on a dedicated connection for the
    // span of this check.
    return runAsTenantJob(this.dataSource, organizationId, async () => {
      const period = await resolvePostingPeriod(
        this.periodRepo.manager,
        organizationId,
        transactionDate,
        ModuleSlug.GL,
        { createIfMissing: true },
      );

      const accountIds = ((body?.lines ?? []) as Array<{ accountId?: string }>)
        .map((line) => line.accountId)
        .filter((id): id is string => Boolean(id));

      if (accountIds.length === 0) return true;

      // `innerJoinAndSelect`, so `lock.account` is actually populated and the message below can name
      // the account instead of dereferencing undefined.
      const lockedAccount = await this.lockRepo
        .createQueryBuilder('lock')
        .innerJoinAndSelect('lock.account', 'account')
        .where('lock.periodId = :periodId', { periodId: period.id })
        .andWhere('lock.organizationId = :organizationId', { organizationId })
        .andWhere('lock.accountId IN (:...accountIds)', { accountIds })
        .andWhere('lock.isLocked = true')
        .getOne();

      if (lockedAccount) {
        throw new ForbiddenError('accounting.account_code_locked_transactions_period_name', {
          code: lockedAccount.account?.code ?? lockedAccount.accountId,
          name: period.name,
        });
      }

      return true;
    });
  }
}
