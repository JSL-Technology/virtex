import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccountingPostingPort, PostingContext } from '../../journal-entries/accounting-posting.port';
import { CreateJournalEntryLineDto } from '../../journal-entries/dto/create-journal-entry.dto';
import { JournalEntryType } from '../../journal-entries/entities/journal-entry.entity';
import { BadRequestError } from '../../i18n/localized.exception';
import { sumAmounts } from '../../common/money';
import { PayrollRun } from '../entities/payroll-run.entity';
import { Payslip, PayslipContribution } from '../entities/payslip.entity';
import { LedgerNarrativeService } from '../../journal-entries/ledger-narrative.service';
import { LedgerLookupService } from '../../accounting/services/ledger-lookup.service';
import { JournalLookupService } from '../../journal-entries/services/journal-lookup.service';
import { OrgSettingsService } from '../../organizations/services/org-settings.service';
import type { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';

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
 *   DR  Employer contributions expense     every statutory employer share + employer concepts
 *       CR  Net wages payable              what employees take home
 *       CR  Pension contributions payable  employee + employer shares of PENSION contributions
 *       CR  Health contributions payable   employee + employer shares of HEALTH contributions
 *       CR  Other contributions payable    every OTHER statutory contribution
 *       CR  Income tax withholding payable income tax withheld
 *       CR  Accounts payable               any other employee deduction
 *
 * which balances by construction: net = gross − (employee contributions + income tax + other), so
 * the credits sum to gross + the employer shares, exactly the debits.
 *
 * Which liability a contribution goes to is the contribution's BUCKET, declared by the country's
 * strategy (audit 2026-11-07, JUR-01): DO puts AFP in PENSION, SFS in HEALTH, SRL and INFOTEP in
 * OTHER; a second country's funds route themselves with no change here.
 */
@Injectable()
export class PayrollAccountingService {
  private readonly logger = new Logger(PayrollAccountingService.name);

  constructor(
    private readonly posting: AccountingPostingPort,
    /** The ledger's narrative, in the language the books are kept in. */
    private readonly narrative: LedgerNarrativeService,
    private readonly ledgerLookup: LedgerLookupService,
    private readonly journalLookup: JournalLookupService,
    private readonly orgSettings: OrgSettingsService,
  ) {}

  async postRun(
    manager: EntityManager,
    run: PayrollRun,
    payslips: Payslip[],
    context: PostingContext,
  ): Promise<string> {
    const settings = await this.orgSettings.getForOrg(run.organizationId, manager);
    const ledger = await this.ledgerLookup.requireDefault(run.organizationId, manager);
    if (run.currencyCode !== ledger.currency) {
      // Payroll in a currency other than the books' would need conversion at the run date; refused
      // loudly rather than posted at an implicit 1:1 rate.
      throw new BadRequestError('payroll.payroll_currency_p1_differs_from_ledger', {
        p1: run.currencyCode,
        p2: ledger.currency,
      });
    }

    const journal = await this.journalLookup.requireByCode(run.organizationId, 'NOMINA', manager);

    const accounts = this.resolveAccounts(settings);

    // Aggregate the run in cents-accurate sums. Amounts may be negative when the run is an
    // adjustment (a delta), which is why the posting below is sign-aware.
    const salaryExpense = sumAmounts(payslips.map((p) => p.grossEarnings));
    const contributions = payslips.flatMap((p) => p.statutoryContributions ?? []);
    const bucketTotal = (bucket: PayslipContribution['bucket']) =>
      sumAmounts(
        contributions.filter((c) => c.bucket === bucket).flatMap((c) => [c.employeeAmount, c.employerAmount]),
      );
    const employerExpense = sumAmounts(
      payslips.flatMap((p) => [p.statutoryEmployerContributions, p.otherEmployerContributions]),
    );
    const netPayable = sumAmounts(payslips.map((p) => p.netPay));
    const pensionPayable = bucketTotal('PENSION');
    const healthPayable = bucketTotal('HEALTH');
    const otherContributionsPayable = bucketTotal('OTHER');
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

    //  El relato del asiento en el idioma en que se llevan los libros del inquilino. Nombra la clase
    //  de pasivo; la institución ya la nombra la cuenta (AFP, IMSS…), que es del paquete del país.
    const words = await this.narrative.describeAll(manager, run.organizationId, {
      salary: { key: 'ledger.payroll.salary_expense' },
      employer: { key: 'ledger.payroll.employer_contributions' },
      net: { key: 'ledger.payroll.net_payable' },
      pension: { key: 'ledger.payroll.pension_payable' },
      health: { key: 'ledger.payroll.health_payable' },
      otherContributions: { key: 'ledger.payroll.other_contributions_payable' },
      isr: { key: 'ledger.payroll.isr_payable' },
      otherDeductions: { key: 'ledger.payroll.other_deductions' },
      employerBenefits: { key: 'ledger.payroll.employer_benefits' },
      entry: { key: 'ledger.payroll.run', params: { run: run.name } },
    });

    debit(accounts.salaryExpense, salaryExpense, words.salary);
    debit(accounts.employerContributionsExpense, employerExpense, words.employer);
    credit(accounts.netPayable, netPayable, words.net);
    credit(accounts.pensionPayable, pensionPayable, words.pension);
    credit(accounts.healthPayable, healthPayable, words.health);
    credit(accounts.otherContributionsPayable, otherContributionsPayable, words.otherContributions);
    credit(accounts.isrWithholdingPayable, isrPayable, words.isr);
    if (otherPayable !== 0 || employerBenefitsPayable !== 0) {
      if (!accounts.accountsPayable) {
        throw new BadRequestError('payroll.no_account_configured_other_deductions_benefits');
      }
      credit(accounts.accountsPayable, otherPayable, words.otherDeductions);
      credit(accounts.accountsPayable, employerBenefitsPayable, words.employerBenefits);
    }

    if (lines.length < 2) {
      throw new BadRequestError('payroll.run_has_no_amounts_post');
    }

    const entry = await this.posting.createWithManager(
      manager,
      {
        date: run.periodEnd,
        description: words.entry,
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
    /** When the money left; the run's planned pay date only for callers that do not know. */
    paymentDate?: string,
  ): Promise<string | null> {
    if (netAmount === 0) return null;

    const settings = await this.orgSettings.getForOrg(run.organizationId, manager);
    const ledger = await this.ledgerLookup.requireDefault(run.organizationId, manager);
    const journal = await this.journalLookup.requireByCode(run.organizationId, 'NOMINA', manager);
    const netPayableAccount = settings?.defaultPayrollNetPayableAccountId;
    if (!netPayableAccount) {
      throw new BadRequestError('payroll.payroll_ledger_accounts_not_configured_p1', { p1: 'Sueldos por pagar' });
    }

    const ledgerId = ledger.id;
    const value = Math.abs(netAmount);
    const payableOnDebit = netAmount > 0; // paying the liability down is a debit to it
    const paid = await this.narrative.describeAll(manager, run.organizationId, {
      settled: { key: 'ledger.payroll.net_paid' },
      reversed: { key: 'ledger.payroll.net_adjusted' },
      bankOut: { key: 'ledger.payroll.bank_out' },
      bankBack: { key: 'ledger.payroll.bank_back' },
      entry: { key: 'ledger.payroll.payment', params: { run: run.name } },
    });
    const lines: CreateJournalEntryLineDto[] = [
      payableOnDebit
        ? { accountId: netPayableAccount, debit: value, credit: 0, description: paid.settled, valuations: [{ ledgerId, debit: value, credit: 0 }] }
        : { accountId: netPayableAccount, debit: 0, credit: value, description: paid.reversed, valuations: [{ ledgerId, debit: 0, credit: value }] },
      payableOnDebit
        ? { accountId: bankGlAccountId, debit: 0, credit: value, description: paid.bankOut, valuations: [{ ledgerId, debit: 0, credit: value }] }
        : { accountId: bankGlAccountId, debit: value, credit: 0, description: paid.bankBack, valuations: [{ ledgerId, debit: value, credit: 0 }] },
    ];

    const entry = await this.posting.createWithManager(
      manager,
      {
        date: paymentDate ?? run.payDate,
        description: paid.entry,
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
      pensionPayable: need(settings?.defaultPensionContributionsPayableAccountId, 'Aportes de pensión por pagar'),
      healthPayable: need(settings?.defaultHealthContributionsPayableAccountId, 'Aportes de salud por pagar'),
      otherContributionsPayable: need(
        settings?.defaultOtherPayrollContributionsPayableAccountId,
        'Otros aportes laborales por pagar',
      ),
      isrWithholdingPayable: need(
        settings?.defaultPayrollTaxWithholdingPayableAccountId,
        'Impuesto sobre la renta retenido por pagar',
      ),
      accountsPayable: settings?.defaultAccountsPayableId ?? null,
    };

    if (missing.length > 0) {
      throw new BadRequestError('payroll.payroll_ledger_accounts_not_configured_p1', {
        p1: missing.join('; '),
      });
    }
    return accounts;
  }
}
