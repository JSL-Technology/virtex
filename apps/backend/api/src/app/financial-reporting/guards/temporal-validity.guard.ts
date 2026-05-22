
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Account } from '../../chart-of-accounts/entities/account.entity';

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
        throw new ForbiddenException(`La cuenta ${account.code} no es válida hasta ${account.effectiveFrom}.`);
      }
      if (account.effectiveTo && transactionDate > new Date(account.effectiveTo)) {
        throw new ForbiddenException(`La cuenta ${account.code} expiró el ${account.effectiveTo}.`);
      }
    }

    return true;
  }
}