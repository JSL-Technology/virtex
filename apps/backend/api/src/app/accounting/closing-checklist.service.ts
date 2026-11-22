import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import {
  ApprovalRequest,
  ApprovalStatus,
} from '../workflows/entities/approval-request.entity';
import { NotFoundError } from '../i18n/localized.exception';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';
import { JournalQueryService } from '../journal-entries/services/journal-query.service';
import { ClosingBlockerRegistry } from '../contracts/closing-blockers/closing-blocker.registry';
import { ClosingBlocker } from '../contracts/closing-blockers/closing-blocker.contract';
import { CurrencyRevaluationService } from './services/currency-revaluation.service';
import { InflationAdjustmentService } from './inflation-adjustment.service';
import { toIsoMonth } from '../common/dates';

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
    private readonly journalQuery: JournalQueryService,
    private readonly closingBlockers: ClosingBlockerRegistry,
    private readonly revaluation: CurrencyRevaluationService,
    private readonly inflation: InflationAdjustmentService,
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

    const unpostedEntriesCount = await this.journalQuery.countUnpostedEntriesInPeriod(
      organizationId,
      toIsoDate(period.startDate),
      toIsoDate(period.endDate),
    );
    checklist.push({
      id: 'unposted-journal-entries',
      descriptionKey: 'accounting.checklist.items.unposted_journal_entries',
      params: { count: unpostedEntriesCount },
      isCompleted: unpostedEntriesCount === 0,
      details: { pendingCount: unpostedEntriesCount },
      resolutionLink: `/accounting/journal-entries?periodId=${periodId}&status=draft,pending_approval`,
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
    const pendingReversals = await this.journalQuery.countPendingAccrualReversals(
      organizationId,
      toIsoDate(period.startDate),
    );
    checklist.push({
      id: 'pending-accrual-reversals',
      descriptionKey: 'accounting.checklist.items.pending_accrual_reversals',
      params: { count: pendingReversals },
      isCompleted: pendingReversals === 0,
      details: { pendingCount: pendingReversals },
      resolutionLink: `/accounting/journal-entries?reversesNextPeriod=true&isReversed=false`,
    });

    // The revaluation is not a manual step: the close runs it, restating the open foreign-currency
    // balances of the revalued accounts at the period's closing rate, and stops if a rate is
    // missing. This says, from the same computation, what it will find (FIN-AC-03). It used to be a
    // line that could never be ticked.
    const outlook = await this.revaluation.outlook(period.endDate, organizationId);
    checklist.push({
      id: 'currency-revaluation',
      descriptionKey:
        outlook.missingRates.length > 0
          ? 'accounting.checklist.items.revaluation_rates_missing'
          : outlook.positions > 0
            ? 'accounting.checklist.items.revaluation_ready'
            : 'accounting.checklist.items.revaluation_nothing',
      params: {
        count: outlook.positions,
        currencies: outlook.currencies.join(', '),
        missing: outlook.missingRates.join(', '),
      },
      isCompleted: outlook.missingRates.length === 0,
      details: { pendingCount: outlook.missingRates.length },
      ...(outlook.missingRates.length > 0 ? { resolutionLink: '/masters/currencies/exchange-rates' } : {}),
    });
    // Foreign-currency balances the close leaves at their historical rate, on balance-sheet accounts:
    // for the accountant to confirm each is not money (inventory, property, an advance) — if one
    // is, its account is marked as revalued. Informative: nothing here stops a close.
    if (outlook.historical.length > 0) {
      checklist.push({
        id: 'historical-fx-balances',
        descriptionKey: 'accounting.checklist.items.historical_fx_balances',
        params: {
          count: outlook.historical.length,
          accounts: outlook.historical.map((position) => `${position.code} (${position.currency})`).join(', '),
        },
        isCompleted: true,
        noteKey: 'accounting.checklist.historical_fx_note',
        details: { pendingCount: outlook.historical.length },
        resolutionLink: '/accounting/chart-of-accounts',
      });
    }

    // The restatement for inflation, where the company's policy calls for it at this close
    // (FIN-AC-04): what the close will book, or what stops it — the series, the month's index, the
    // account of the net monetary position — from the computation the close itself runs. Shown too
    // when the month was restated by hand, so a run the books outgrew is not a surprise.
    const restatement = await this.inflation.outlook(organizationId, toIsoMonth(period.endDate));
    if (restatement.dueAtClose || restatement.run) {
      const [blocker] = restatement.blockers;
      checklist.push({
        id: 'inflation-adjustment',
        descriptionKey: blocker
          ? blocker.key
          : !restatement.run
            ? 'accounting.checklist.items.inflation_adjustment_ready'
            : restatement.current
              ? 'accounting.checklist.items.inflation_adjustment_posted'
              : 'accounting.checklist.items.inflation_adjustment_outdated',
        params: blocker?.params ?? {
          period: restatement.period,
          count: restatement.lines.length,
          result: restatement.netMonetaryResult,
        },
        isCompleted: !blocker,
        details: { pendingCount: blocker ? 1 : 0 },
        resolutionLink: '/accounting/inflation-adjustment',
      });
    }

    checklist.push({
      id: 'fixed-assets-depreciation',
      descriptionKey: 'accounting.checklist.items.fixed_assets_depreciation',
      isCompleted: false,
      noteKey: 'accounting.checklist.manual_step',
      resolutionLink: `/accounting/fixed-assets/depreciation`,
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
      resolutionLink: `/approvals`,
    });

    return checklist;
  }
}
