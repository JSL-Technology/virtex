import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In, Between, LessThan } from 'typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import {
  JournalEntry,
  JournalEntryStatus,
} from '../journal-entries/entities/journal-entry.entity';
import {
  ApprovalRequest,
  ApprovalStatus,
} from '../workflows/entities/approval-request.entity';
import { NotFoundError } from '../i18n/localized.exception';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';
import { ClosingBlockerRegistry } from '../contracts/closing-blockers/closing-blocker.registry';
import { ClosingBlocker } from '../contracts/closing-blockers/closing-blocker.contract';

/**
 * Una línea del checklist, tal como la ve el cliente.
 *
 * Es el tipo del contrato, reexportado: la forma que Contabilidad publica por HTTP y la que los
 * demás módulos rellenan tienen que ser la misma, o el contrato no estaría diciendo nada.
 */
export type ChecklistItem = ClosingBlocker;

@Injectable()
export class ClosingChecklistService {
  private readonly logger = new Logger(ClosingChecklistService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly closingBlockers: ClosingBlockerRegistry,
  ) {}

  async getChecklist(
    periodId: string,
    organizationId: string,
  ): Promise<ChecklistItem[]> {
    this.logger.log(
      `Generando checklist de cierre para el período ${periodId} en la organización ${organizationId}`,
    );

    const period = await this.dataSource
      .getRepository(AccountingPeriod)
      .findOneBy({ id: periodId, organizationId });
    if (!period) {
      throw new NotFoundError('accounting.accounting_period_period_id_not_found', { periodId });
    }

    const checklist: ChecklistItem[] = [];

    const unpostedEntriesCount = await this.dataSource
      .getRepository(JournalEntry)
      .count({
        where: {
          organizationId,
          status: In([
            JournalEntryStatus.DRAFT,
            JournalEntryStatus.PENDING_APPROVAL,
          ]),
          date: Between(period.startDate, period.endDate),
        },
      });
    checklist.push({
      id: 'unposted-journal-entries',
      descriptionKey: 'accounting.checklist.items.unposted_journal_entries',
      params: { count: unpostedEntriesCount },
      isCompleted: unpostedEntriesCount === 0,
      details: { pendingCount: unpostedEntriesCount },
      resolutionLink: `/journal-entries?periodId=${periodId}&status=draft,pending_approval`,
    });

    // Lo que aportan los demás módulos, preguntado sin saber quiénes son.
    //
    // Aquí se contaban facturas de proveedor sin aprobar y líneas de banco sin conciliar
    // importando `VendorBill` y `BankTransaction`. Eran dos líneas de import y entre las dos
    // sostenían los ciclos `compras ↔ contabilidad` y `contabilidad ↔ finanzas`. La posición en la
    // lista se conserva para que el checklist no cambie de orden entre dos cargas.
    checklist.push(
      ...(await this.closingBlockers.collect({
        organizationId,
        periodId,
        startDate: toIsoDate(period.startDate),
        endDate: toIsoDate(period.endDate),
      })),
    );


    // Accruals that should have reversed into this period and did not.
    //
    // `AutoReversalService` reverses each flagged accrual on the first of the following month and
    // logs the ones it cannot — a closed period, a reconciled line. That log is read by nobody: an
    // accrual left standing overstates the next period's result by its own amount, and the person
    // closing that period is exactly who needs to know. Here it is a line of the checklist, with
    // the entries named.
    const pendingReversals = await this.dataSource.getRepository(JournalEntry).count({
      where: {
        organizationId,
        reversesNextPeriod: true,
        isReversed: false,
        status: JournalEntryStatus.POSTED,
        date: LessThan(toIsoDate(period.startDate) as unknown as Date),
      },
    });
    checklist.push({
      id: 'pending-accrual-reversals',
      descriptionKey: 'accounting.checklist.items.pending_accrual_reversals',
      params: { count: pendingReversals },
      isCompleted: pendingReversals === 0,
      details: { pendingCount: pendingReversals },
      resolutionLink: `/journal-entries?reversesNextPeriod=true&isReversed=false`,
    });

    checklist.push({
      id: 'currency-revaluation',
      descriptionKey: 'accounting.checklist.items.currency_revaluation',
      isCompleted: false,
      noteKey: 'accounting.checklist.manual_step',
      resolutionLink: `/accounting/currency-revaluation`,
    });

    checklist.push({
      id: 'fixed-assets-depreciation',
      descriptionKey: 'accounting.checklist.items.fixed_assets_depreciation',
      isCompleted: false,
      noteKey: 'accounting.checklist.manual_step',
      resolutionLink: `/fixed-assets/depreciation`,
    });

    const pendingApprovalsCount = await this.dataSource
      .getRepository(ApprovalRequest)
      .count({
        where: {
          organizationId,
          status: ApprovalStatus.PENDING,
        },
      });
    checklist.push({
      id: 'pending-general-approvals',
      descriptionKey: 'accounting.checklist.items.pending_approvals',
      params: { count: pendingApprovalsCount },
      isCompleted: pendingApprovalsCount === 0,
      details: { pendingCount: pendingApprovalsCount },
      resolutionLink: `/my-work/approvals`,
    });

    return checklist;
  }
}
