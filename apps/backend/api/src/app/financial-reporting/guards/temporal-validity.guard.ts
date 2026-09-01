
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { ForbiddenError } from '../../i18n/localized.exception';

@Injectable()
export class TemporalValidityGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { body } = request;

    const transactionDateStr = body.date || body.issueDate;
    if (!transactionDateStr || !body.lines) {
      return true;
    }

    const transactionDate = new Date(transactionDateStr);
    const accountIds = [...new Set(body.lines.map((line: any) => line.accountId).filter(Boolean))];

    if (accountIds.length === 0) {
      return true;
    }

    const accounts = await this.dataSource.getRepository(Account).findByIds(accountIds);

    for (const account of accounts) {
      if (account.effectiveFrom && transactionDate < new Date(account.effectiveFrom)) {
        throw new ForbiddenError('FINANCIAL_REPORTING.CUENTA_NO_ES_VALIDA_HASTA', { code: account.code, effectiveFrom: account.effectiveFrom });
      }
      if (account.effectiveTo && transactionDate > new Date(account.effectiveTo)) {
        throw new ForbiddenError('FINANCIAL_REPORTING.CUENTA_EXPIRO', { code: account.code, effectiveTo: account.effectiveTo });
      }
    }

    return true;
  }
}