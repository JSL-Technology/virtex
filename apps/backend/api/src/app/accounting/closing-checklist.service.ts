import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, In, Between } from 'typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import {
  JournalEntry,
  JournalEntryStatus,
} from '../journal-entries/entities/journal-entry.entity';
import {
  BankTransaction,
  TransactionStatus,
} from '../reconciliation/entities/bank-transaction.entity';
import {
  VendorBill,
  VendorBillStatus,
} from '../accounts-payable/entities/vendor-bill.entity';
import {
  ApprovalRequest,
  ApprovalStatus,
} from '../workflows/entities/approval-request.entity';

export interface ChecklistItem {
  id: string;
  description: string;
  isCompleted: boolean;
  details?: any;
  resolutionLink?: string;
}

@Injectable()
export class ClosingChecklistService {
  private readonly logger = new Logger(ClosingChecklistService.name);

  constructor(private readonly dataSource: DataSource) {}

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
      throw new NotFoundException(
        `Período contable con ID "${periodId}" no encontrado.`,
      );
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
      description:
        'Verificar y procesar todos los asientos contables en borrador o pendientes de aprobación.',
      isCompleted: unpostedEntriesCount === 0,
      details: { pendingCount: unpostedEntriesCount },
      resolutionLink: `/journal-entries?periodId=${periodId}&status=draft,pending_approval`,
    });

    const unapprovedBillsCount = await this.dataSource
      .getRepository(VendorBill)
      .count({
        where: {
          organizationId,
          status: In([
            VendorBillStatus.DRAFT,
            VendorBillStatus.PENDING_APPROVAL,
          ]),
          date: Between(period.startDate, period.endDate),
        },
      });
    checklist.push({
      id: 'unapproved-vendor-bills',
      description:
        'Verificar y procesar todas las facturas de proveedor en borrador o pendientes de aprobación.',
      isCompleted: unapprovedBillsCount === 0,
      details: { pendingCount: unapprovedBillsCount },
      resolutionLink: `/accounts-payable/bills?periodId=${periodId}&status=draft,pending_approval`,
    });

    const unreconciledTxCount = await this.dataSource
      .getRepository(BankTransaction)
      .count({
        where: {
          statement: { organizationId },
          status: TransactionStatus.UNRECONCILED,
          date: Between(period.startDate, period.endDate),
        },
      });
    checklist.push({
      id: 'unreconciled-bank-transactions',
      description: 'Conciliar todas las transacciones bancarias del período.',
      isCompleted: unreconciledTxCount === 0,
      details: { unreconciledCount: unreconciledTxCount },
      resolutionLink: `/reconciliation?periodId=${periodId}`,
    });

    checklist.push({
      id: 'currency-revaluation',
      description:
        'Ejecutar el proceso de revaluación de moneda extranjera para el cierre del período.',
      isCompleted: false,
      details: {
        message:
          'Este es un paso manual. Asegúrese de haber corrido el proceso antes de cerrar.',
      },
      resolutionLink: `/accounting/currency-revaluation`,
    });

    checklist.push({
      id: 'fixed-assets-depreciation',
      description:
        'Ejecutar el proceso de depreciación de activos fijos para el mes.',
      isCompleted: false,
      details: {
        message:
          'Este es un paso manual. Asegúrese de haber corrido el proceso antes de cerrar.',
      },
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
      description:
        'Revisar y procesar todas las solicitudes de aprobación pendientes en el sistema.',
      isCompleted: pendingApprovalsCount === 0,
      details: { pendingCount: pendingApprovalsCount },
      resolutionLink: `/my-work/approvals`,
    });

    return checklist;
  }
}
