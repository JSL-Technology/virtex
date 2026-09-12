import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JournalEntriesService } from '../../journal-entries/journal-entries.service';
import { PostingContext } from '../../journal-entries/journal-entries.service';
import { CreateJournalEntryLineDto } from '../../journal-entries/dto/create-journal-entry.dto';
import { JournalEntryType } from '../../journal-entries/entities/journal-entry.entity';
import { Journal } from '../../journal-entries/entities/journal.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { BadRequestError } from '../../i18n/localized.exception';
import { sumAmounts } from '../../common/money';
import { PayrollRun } from '../entities/payroll-run.entity';
import { Payslip } from '../entities/payslip.entity';

/**
 * Posts a payroll run to the general ledger — one balanced, idempotent entry.
 *
 * ## The contract with Contabilidad
 *
 * The audit's requirement is that Contabilidad receives amounts already balanced and validated, not
 * a total it must trust. This builds the entry from the run's own payslips, routes every figure to
 * an account resolved from `OrganizationSettings` (never a substitute), and hands it to
 * `JournalEntriesService`, which re-validates the balance in cents and refuses an unbalanced entry.
 * The posting is idempotent on `payroll:{runId}` — an approval retried after a crash returns the
 * entry the first attempt wrote rather than posting the wage bill twice.
 *
 * ## The entry
 *
 *   DR  Salary expense                     gross remuneration
 *   DR  Employer contributions expense     AFP+SFS+SRL+INFOTEP employer shares
 *       CR  Net wages payable              what employees take home
 *       CR  AFP payable                    employee + employer pension, owed to TSS
 *       CR  SFS payable                    employee + employer health, owed to TSS
 *       CR  SRL/INFOTEP payable            employer risk + training, owed to TSS/INFOTEP
 *       CR  ISR withholding payable        income tax withheld, owed to DGII
 *       CR  Accounts payable               any other employee deduction
 *
 * which balances by construction: net = gross − (employee AFP+SFS+ISR+other), so the credits sum to
 * gross + the employer shares, exactly the debits.
 */
@Injectable()
export class PayrollAccountingService {
  private readonly logger = new Logger(PayrollAccountingService.name);

  constructor(private readonly journalEntries: JournalEntriesService) {}

  async postRun(
    manager: EntityManager,
    run: PayrollRun,
    payslips: Payslip[],
    context: PostingContext,
  ): Promise<string> {
    const settings = await manager.findOneBy(OrganizationSettings, {
      organizationId: run.organizationId,
    });
    const ledger = await manager.findOneBy(Ledger, {
      organizationId: run.organizationId,
      isDefault: true,
    });
    if (!ledger) {
      throw new BadRequestError('PAYROLL.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
    }
    if (run.currencyCode !== ledger.currency) {
      // Payroll in a currency other than the books' would need conversion at the run date; refused
      // loudly rather than posted at an implicit 1:1 rate.
      throw new BadRequestError('PAYROLL.MONEDA_NOMINA_DISTINTA_MONEDA_LIBRO', {
        p1: run.currencyCode,
        p2: ledger.currency,
      });
    }

    const journal = await manager.findOneBy(Journal, {
      organizationId: run.organizationId,
      code: 'NOMINA',
    });
    if (!journal) {
      throw new BadRequestError('PAYROLL.DIARIO_NOMINA_NO_ENCONTRADO_FAVOR_CREE');
    }

    const accounts = this.resolveAccounts(settings);

    // Aggregate the run in cents-accurate sums. Amounts may be negative when the run is an
    // adjustment (a delta), which is why the posting below is sign-aware.
    const salaryExpense = sumAmounts(payslips.map((p) => p.grossEarnings));
    const employerExpense = sumAmounts(
      payslips.flatMap((p) => [
        p.afpEmployer,
        p.sfsEmployer,
        p.srlEmployer,
        p.infotepEmployer,
        p.otherEmployerContributions,
      ]),
    );
    const netPayable = sumAmounts(payslips.map((p) => p.netPay));
    const afpPayable = sumAmounts(payslips.flatMap((p) => [p.afpEmployee, p.afpEmployer]));
    const sfsPayable = sumAmounts(payslips.flatMap((p) => [p.sfsEmployee, p.sfsEmployer]));
    // INFOTEP payable groups the employer SRL + INFOTEP and the employee INFOTEP levy on the regalía.
    const riskTrainingPayable = sumAmounts(
      payslips.flatMap((p) => [p.srlEmployer, p.infotepEmployer, p.infotepEmployee]),
    );
    const isrPayable = sumAmounts(payslips.map((p) => p.incomeTax));
    const otherPayable = sumAmounts(payslips.map((p) => p.otherDeductions));
    const employerBenefitsPayable = sumAmounts(payslips.map((p) => p.otherEmployerContributions));

    const ledgerId = ledger.id;
    const lines: CreateJournalEntryLineDto[] = [];
    // Sign-aware: a positive figure posts to its natural side; a negative one (an adjustment that
    // reduces a previously-booked amount) posts to the opposite side. The entry still balances because
    // a delta of two balanced entries is itself balanced.
    const post = (accountId: string, amount: number, naturalDebit: boolean, description: string) => {
      if (amount === 0) return;
      const onDebit = naturalDebit === amount > 0;
      const value = Math.abs(amount);
      lines.push(
        onDebit
          ? { accountId, debit: value, credit: 0, description, valuations: [{ ledgerId, debit: value, credit: 0 }] }
          : { accountId, debit: 0, credit: value, description, valuations: [{ ledgerId, debit: 0, credit: value }] },
      );
    };
    const debit = (accountId: string, amount: number, description: string) => post(accountId, amount, true, description);
    const credit = (accountId: string, amount: number, description: string) => post(accountId, amount, false, description);

    debit(accounts.salaryExpense, salaryExpense, 'Gasto de sueldos y salarios');
    debit(accounts.employerContributionsExpense, employerExpense, 'Aportes patronales y beneficios');
    credit(accounts.netPayable, netPayable, 'Sueldos por pagar (neto)');
    credit(accounts.afpPayable, afpPayable, 'AFP por pagar (TSS)');
    credit(accounts.sfsPayable, sfsPayable, 'SFS por pagar (TSS)');
    credit(accounts.infotepPayable, riskTrainingPayable, 'SRL/INFOTEP por pagar');
    credit(accounts.isrWithholdingPayable, isrPayable, 'ISR retenido por pagar (DGII)');
    if (otherPayable !== 0 || employerBenefitsPayable !== 0) {
      if (!accounts.accountsPayable) {
        throw new BadRequestError('PAYROLL.SIN_CUENTA_PARA_OTRAS_DEDUCCIONES');
      }
      credit(accounts.accountsPayable, otherPayable, 'Otras deducciones por pagar');
      credit(accounts.accountsPayable, employerBenefitsPayable, 'Beneficios patronales por pagar');
    }

    if (lines.length < 2) {
      throw new BadRequestError('PAYROLL.CORRIDA_SIN_MONTOS_QUE_CONTABILIZAR');
    }

    const entry = await this.journalEntries.createWithManager(
      manager,
      {
        date: run.periodEnd,
        description: `Nómina ${run.name}`,
        journalId: journal.id,
        entryType: JournalEntryType.SYSTEM_GENERATED,
        lines,
      },
      run.organizationId,
      { ...context, idempotencyKey: `payroll:${run.id}`, systemReason: 'payroll-run' },
    );

    this.logger.log(`Nómina ${run.id} contabilizada en asiento ${entry.id}.`);
    return entry.id;
  }

  /**
   * Post the disbursement of an approved run: the net wages leave the bank and the payable clears.
   *
   *   DR  Net wages payable   the liability approval created
   *       CR  Bank            the cash that actually left
   *
   * Idempotent on `payroll-payment:{runId}`, so a retried settlement never double-credits the bank.
   * A zero net (an adjustment that only moved employer costs) books nothing. A negative net (a
   * clawback) reverses the sides. The bank/cash GL account is chosen by treasury and passed in.
   */
  async postPayment(
    manager: EntityManager,
    run: PayrollRun,
    bankGlAccountId: string,
    netAmount: number,
    context: PostingContext,
  ): Promise<string | null> {
    if (netAmount === 0) return null;

    const settings = await manager.findOneBy(OrganizationSettings, {
      organizationId: run.organizationId,
    });
    const ledger = await manager.findOneBy(Ledger, {
      organizationId: run.organizationId,
      isDefault: true,
    });
    if (!ledger) {
      throw new BadRequestError('PAYROLL.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
    }
    const journal = await manager.findOneBy(Journal, {
      organizationId: run.organizationId,
      code: 'NOMINA',
    });
    if (!journal) {
      throw new BadRequestError('PAYROLL.DIARIO_NOMINA_NO_ENCONTRADO_FAVOR_CREE');
    }
    const netPayableAccount = settings?.defaultPayrollNetPayableAccountId;
    if (!netPayableAccount) {
      throw new BadRequestError('PAYROLL.CUENTAS_NOMINA_NO_CONFIGURADAS', { p1: 'Sueldos por pagar' });
    }

    const ledgerId = ledger.id;
    const value = Math.abs(netAmount);
    const payableOnDebit = netAmount > 0; // paying the liability down is a debit to it
    const lines: CreateJournalEntryLineDto[] = [
      payableOnDebit
        ? { accountId: netPayableAccount, debit: value, credit: 0, description: 'Pago de nómina (neto)', valuations: [{ ledgerId, debit: value, credit: 0 }] }
        : { accountId: netPayableAccount, debit: 0, credit: value, description: 'Ajuste de pago de nómina', valuations: [{ ledgerId, debit: 0, credit: value }] },
      payableOnDebit
        ? { accountId: bankGlAccountId, debit: 0, credit: value, description: 'Salida de banco por nómina', valuations: [{ ledgerId, debit: 0, credit: value }] }
        : { accountId: bankGlAccountId, debit: value, credit: 0, description: 'Reingreso a banco por ajuste', valuations: [{ ledgerId, debit: value, credit: 0 }] },
    ];

    const entry = await this.journalEntries.createWithManager(
      manager,
      {
        date: run.payDate,
        description: `Pago de nómina ${run.name}`,
        journalId: journal.id,
        entryType: JournalEntryType.SYSTEM_GENERATED,
        lines,
      },
      run.organizationId,
      { ...context, idempotencyKey: `payroll-payment:${run.id}`, systemReason: 'payroll-payment' },
    );
    this.logger.log(`Pago de nómina ${run.id} contabilizado en asiento ${entry.id}.`);
    return entry.id;
  }

  /** Every payroll account, or a clear error naming the ones the tenant has not configured. */
  private resolveAccounts(settings: OrganizationSettings | null) {
    const missing: string[] = [];
    const need = (id: string | null | undefined, label: string): string => {
      if (!id) {
        missing.push(label);
        return '';
      }
      return id;
    };

    const accounts = {
      salaryExpense: need(settings?.defaultSalaryExpenseAccountId, 'Gasto de sueldos'),
      employerContributionsExpense: need(
        settings?.defaultEmployerContributionsExpenseAccountId,
        'Gasto de aportes patronales',
      ),
      netPayable: need(settings?.defaultPayrollNetPayableAccountId, 'Sueldos por pagar'),
      afpPayable: need(settings?.defaultAfpPayableAccountId, 'AFP por pagar'),
      sfsPayable: need(settings?.defaultSfsPayableAccountId, 'SFS por pagar'),
      infotepPayable: need(settings?.defaultInfotepPayableAccountId, 'SRL/INFOTEP por pagar'),
      isrWithholdingPayable: need(
        settings?.defaultPayrollTaxWithholdingPayableAccountId,
        'ISR retenido por pagar',
      ),
      accountsPayable: settings?.defaultAccountsPayableId ?? null,
    };

    if (missing.length > 0) {
      throw new BadRequestError('PAYROLL.CUENTAS_NOMINA_NO_CONFIGURADAS', {
        p1: missing.join('; '),
      });
    }
    return accounts;
  }
}
