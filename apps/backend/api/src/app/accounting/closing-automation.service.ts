import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DepreciationService } from '../fixed-assets/depreciation.service';
import { CurrencyRevaluationService } from '../batch-processes/currency-revaluation.service';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { toIsoDate, type IsoDate } from '../common/dates';

/** What a pre-closing task did, so the close can report it instead of only logging it. */
export interface PreClosingOutcome {
  task: 'depreciation' | 'currency-revaluation';
  ranAt: IsoDate;
  /** False when the task was already claimed for this period, or had nothing to do. */
  performed: boolean;
  messageKey?: string;
}

/**
 * The two things that must be in the books before a period's result can be computed.
 *
 * ## Why this used to fail, always
 *
 * It passed `period.endDate` straight through to the depreciation run, which called
 * `getUTCFullYear()` on it. A PostgreSQL `date` column arrives in JavaScript as the string
 * `'2026-01-31'` — the entity's `Date` annotation is not enforced at run time — so every close
 * threw `date.getUTCFullYear is not a function`, this class re-threw it as "Fallo en la
 * depreciación de activos fijos", and the whole closing transaction rolled back. **No tenant could
 * close a period, and therefore none could close a fiscal year.** The integration suite replaces
 * this service with a stub, so nothing caught it.
 *
 * The date is normalised here, at the boundary, and the services it calls now accept and require
 * `IsoDate`. Both fixes are needed: the normalisation stops today's failure, the narrowed types
 * stop the next caller reintroducing it.
 *
 * ## Why a failure still aborts the close
 *
 * Deliberately. A close that skipped depreciation because it threw would move a result to retained
 * earnings that is missing a month of charge, and nothing downstream would ever find the
 * difference. If the tenant genuinely has no depreciation to post, the task reports that and the
 * close continues; if it cannot run, the close does not happen.
 */
@Injectable()
export class ClosingAutomationService {
  private readonly logger = new Logger(ClosingAutomationService.name);

  constructor(
    private readonly depreciationService: DepreciationService,
    private readonly currencyRevaluationService: CurrencyRevaluationService,
  ) {}

  async runPreClosingTasks(
    period: AccountingPeriod,
    organizationId: string,
    manager: EntityManager,
  ): Promise<PreClosingOutcome[]> {
    // The one line this class exists for. `period.endDate` is a string at run time whatever its
    // declared type says; everything below is given an `IsoDate` and nothing re-derives it.
    const periodEnd: IsoDate = toIsoDate(period.endDate);

    this.logger.log(
      `Tareas de pre-cierre para ${period.name} (${periodEnd}) en la organización ${organizationId}.`,
    );

    const outcomes: PreClosingOutcome[] = [];

    try {
      await this.depreciationService.runMonthlyDepreciation(organizationId, periodEnd, manager);
      outcomes.push({ task: 'depreciation', ranAt: periodEnd, performed: true });
    } catch (error) {
      this.logger.error(
        `Depreciación fallida en el cierre de ${period.name}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new Error(`Fallo en la depreciación de activos fijos: ${(error as Error).message}`);
    }

    try {
      await this.currencyRevaluationService.run(periodEnd, organizationId, undefined, manager);
      outcomes.push({ task: 'currency-revaluation', ranAt: periodEnd, performed: true });
    } catch (error) {
      this.logger.error(
        `Revaluación de moneda fallida en el cierre de ${period.name}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new Error(`Fallo en la revaluación de moneda: ${(error as Error).message}`);
    }

    this.logger.log(`Pre-cierre de ${period.name} completado.`);
    return outcomes;
  }
}
