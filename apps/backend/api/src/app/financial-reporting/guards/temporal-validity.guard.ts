import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { UnprocessableEntityError } from '../../i18n/localized.exception';
import { toIsoDate } from '../../common/dates';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';

/**
 * An entry may not touch an account outside the window the account is valid in.
 *
 * ## Scoped to the tenant
 *
 * The accounts were loaded by id alone, so an id belonging to another company was simply not found
 * and the line passed this guard without a window to check. The service behind it owns the real
 * tenancy check, and row-level security is underneath both, but a guard that silently approves
 * what it cannot see is worth nothing as a second line. It now reads the caller's own accounts,
 * and an id that is not one of them is refused here.
 *
 * ## Compared as calendar days
 *
 * `effective_from` and `effective_to` are `date` columns: the day an account opens, not an instant.
 * The comparison used to build a `Date` from each side, so an entry dated `2026-01-15T00:00:00-04:00`
 * became the 15th at 04:00 UTC and an account effective the 15th became the 15th at 00:00 UTC —
 * the same day comparing as later. Both sides are reduced to `YYYY-MM-DD` and compared as strings,
 * which is what a fiscal date is.
 */
@Injectable()
export class TemporalValidityGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { body } = request;

    const transactionDateStr = body?.date || body?.issueDate;
    const organizationId = request.user?.organizationId;
    if (!transactionDateStr || !Array.isArray(body?.lines) || !organizationId) {
      return true;
    }

    const transactionDate = toIsoDate(transactionDateStr);
    const accountIds = [
      ...new Set(body.lines.map((line: { accountId?: string }) => line?.accountId).filter(Boolean)),
    ] as string[];

    if (accountIds.length === 0) {
      return true;
    }

    // Under its own tenant connection, because a guard has none: `TenantConnectionInterceptor` is an
    // `APP_INTERCEPTOR`, and every interceptor runs after every guard. Read on a pooled connection,
    // the accounts sat behind the row-level policies with no company set and none came back — so,
    // connected as the application role, every journal entry was refused as touching «an account
    // that is not this company's». `verify:journal-api`, run as `virtex_app`, is what found it.
    const accounts = await runAsTenantJob(this.dataSource, organizationId, () =>
      this.dataSource.getRepository(Account).find({
        where: { id: In(accountIds), organizationId },
        select: ['id', 'code', 'effectiveFrom', 'effectiveTo'],
      }),
    );

    const found = new Set(accounts.map((account) => account.id));
    const foreign = accountIds.find((id) => !found.has(id));
    if (foreign) {
      throw new UnprocessableEntityError('financial_reporting.account_not_in_this_company');
    }

    for (const account of accounts) {
      if (account.effectiveFrom && transactionDate < toIsoDate(account.effectiveFrom)) {
        throw new UnprocessableEntityError('financial_reporting.account_code_not_valid_until_effective', {
          code: account.code,
          effectiveFrom: toIsoDate(account.effectiveFrom),
        });
      }
      if (account.effectiveTo && transactionDate > toIsoDate(account.effectiveTo)) {
        throw new UnprocessableEntityError('financial_reporting.account_code_expired_effective', {
          code: account.code,
          effectiveTo: toIsoDate(account.effectiveTo),
        });
      }
    }

    return true;
  }
}
