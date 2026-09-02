import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountingPeriod, ModuleSlug } from '../entities/accounting-period.entity';
import { AccountPeriodLock } from '../entities/account-period-lock.entity';
import { ForbiddenError } from '../../i18n/localized.exception';
import { resolvePostingPeriod } from '../period-status';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { body, user } = request;

    if (!user?.organizationId) return true;

    const transactionDateStr = body?.date ?? body?.issueDate ?? body?.paymentDate;
    if (!transactionDateStr) return true;

    const transactionDate = new Date(`${String(transactionDateStr).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(transactionDate.getTime())) return true;

    const organizationId: string = user.organizationId;

    // Throws when the date belongs to no period, to a closed one, or to one whose subledger window
    // is shut. Shared with the posting path so the two cannot drift apart.
    const period = await resolvePostingPeriod(
      this.periodRepo.manager,
      organizationId,
      transactionDate,
      (body?.accountingModule as ModuleSlug) ?? ModuleSlug.GL,
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
      throw new ForbiddenError('ACCOUNTING.CUENTA_ESTA_BLOQUEADA_TRANSACCIONES_PERIODO', {
        code: lockedAccount.account?.code ?? lockedAccount.accountId,
        name: period.name,
      });
    }

    return true;
  }
}
