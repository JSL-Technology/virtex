
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { AccountingPeriod, PeriodStatus } from '../entities/accounting-period.entity';
import { AccountPeriodLock } from '../entities/account-period-lock.entity';

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

    if (!user || !user.organizationId) {
      return true;
    }


    const transactionDateStr = body.date || body.issueDate;
    if (!transactionDateStr) {
      return true;
    }

    const transactionDate = new Date(transactionDateStr);
    if (isNaN(transactionDate.getTime())) {
      return true;
    }

    const organizationId = user.organizationId;
    

    const period = await this.periodRepo.findOne({
      where: {
        organizationId,
        startDate: LessThanOrEqual(transactionDate),
        endDate: MoreThanOrEqual(transactionDate),
      },
    });

    if (!period) {
      const periodsCount = await this.periodRepo.count({
        where: { organizationId },
      });

      if (periodsCount === 0) {
        return true;
      }

      throw new ForbiddenException(
        `La fecha de la transacción ${transactionDate.toISOString().split('T')[0]} no pertenece a ningún período contable definido.`,
      );
    }


    if (period.status === PeriodStatus.CLOSED) {
      throw new ForbiddenException(
        `La fecha de la transacción está dentro de un período contable (${period.name}) que ya ha sido cerrado.`,
      );
    }


    const accountIds = (body.lines || []).map(line => line.accountId).filter(Boolean);
    if (accountIds.length > 0) {
        const lockedAccount = await this.lockRepo.createQueryBuilder('lock')
            .innerJoin('lock.account', 'account')
            .where('lock.periodId = :periodId', { periodId: period.id })
            .andWhere('lock.accountId IN (:...accountIds)', { accountIds })
            .andWhere('lock.isLocked = true')
            .getOne();

        if (lockedAccount) {
            throw new ForbiddenException(
                `La cuenta #${lockedAccount.account.code} está bloqueada para transacciones en el período ${period.name}.`
            );
        }
    }

    return true;
  }
}
