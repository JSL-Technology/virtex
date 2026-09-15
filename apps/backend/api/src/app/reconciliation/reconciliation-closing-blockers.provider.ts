import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  ClosingBlocker,
  ClosingBlockerProvider,
  ClosingPeriodQuery,
} from '../contracts/closing-blockers/closing-blocker.contract';
import { ClosingBlockerRegistry } from '../contracts/closing-blockers/closing-blocker.registry';
import { BankTransaction, TransactionStatus } from './entities/bank-transaction.entity';

/**
 * Lo que Finanzas aporta al checklist de cierre: líneas de extracto sin conciliar.
 *
 * Contabilidad contaba estas filas importando `BankTransaction`, que era una de las aristas que
 * mantenían vivo el ciclo `contabilidad ↔ finanzas`. Que el tenant de la transacción se alcance por
 * la relación con el extracto (`statement.organizationId`) y no por una columna propia es
 * exactamente el tipo de detalle interno que no debe viajar fuera del módulo: aquí queda.
 */
@Injectable()
export class ReconciliationClosingBlockersProvider implements ClosingBlockerProvider, OnModuleInit {
  readonly providerName = 'reconciliation';

  constructor(
    @InjectRepository(BankTransaction)
    private readonly bankTransactions: Repository<BankTransaction>,
    private readonly registry: ClosingBlockerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async blockersFor(period: ClosingPeriodQuery): Promise<readonly ClosingBlocker[]> {
    const unreconciledCount = await this.bankTransactions.count({
      where: {
        statement: { organizationId: period.organizationId },
        status: TransactionStatus.UNMATCHED,
        date: Between(period.startDate, period.endDate),
      },
    });

    return [
      {
        id: 'unreconciled-bank-transactions',
        descriptionKey: 'accounting.checklist.items.unreconciled_bank_transactions',
        params: { count: unreconciledCount },
        isCompleted: unreconciledCount === 0,
        details: { unreconciledCount },
        resolutionLink: `/reconciliation?periodId=${period.periodId}`,
      },
    ];
  }
}
