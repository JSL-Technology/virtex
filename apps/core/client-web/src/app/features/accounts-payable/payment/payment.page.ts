import { VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { LucideAngularModule, ChevronLeft } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { FORMAT_PIPES, FormatService } from '@virteex/shared/ui-i18n';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { BankAccount, TreasuryService } from '../../../core/api/treasury.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { CashPositionRow } from '../../accounting/data/treasury.service';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';

/**
 * Paying supplier invoices.
 *
 * ## Why this page did not exist
 *
 * Nothing could pay a bill. `createPaymentBatch` was on the server, exposed by no controller and
 * called by nothing, and had it been reachable it would have paid every selected bill in full —
 * no partial payment, no discount, no withholding — summing balances across currencies as if they
 * were the same unit. A supplier invoice could be recorded and approved, and then nothing.
 *
 * Only bills that are open or part-paid are offered, because those are the only ones the server
 * will settle, and the account's currency filters the list: paying a USD bill out of a EUR account
 * is a conversion at a rate nobody has stated, and the server refuses it rather than inventing one.
 */
@Component({
  selector: 'app-vendor-payment-page',
  standalone: true,
  imports: [
    VxBranchPickerComponent,
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    DraftShellComponent,
    ...VX_FORM_A11Y, ...VX_SELECT, VxAmountComponent, VxDateFieldComponent],
  templateUrl: './payment.page.html',
  styleUrls: ['./payment.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorPaymentPage implements OnInit {
  /** `?billId=` — from a bill's «Pay»: the bill is on the payment, from an account that can pay it. */
  readonly billId = input<string>();
  private preselected = false;
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly payables = inject(AccountsPayableService);
  private readonly treasury = inject(TreasuryService);
  private readonly notifications = inject(NotificationService);

  form!: FormGroup;
  readonly bankAccounts = signal<BankAccount[]>([]);

  /** «BHD Corriente (DOP)»: la moneda importa tanto como el nombre para elegir una cuenta. */
  protected readonly bankAccountLabel = (account: BankAccount): string =>
    `${account.name} (${account.currencyCode})`;
  protected readonly bankAccountId = (account: BankAccount): string => account.id;

  /**
   * The chosen account, mirrored out of the form.
   *
   * A `computed` cannot read a reactive-forms value: the control is not a signal, so the
   * derivation would be evaluated once and never again, and the list of payable bills would keep
   * showing whatever the first account allowed.
   */
  readonly selectedBankAccountId = signal<string>('');
  private readonly format = inject(FormatService);
  readonly bills = signal<VendorBill[]>([]);
  readonly baseCurrency = signal<string | null>(null);
  readonly saving = signal(false);

  readonly activeBankAccounts = computed(() =>
    this.bankAccounts().filter((account) => account.isActive),
  );

  /**
   * The bills this account can actually settle.
   *
   * The server accepts a bill whose currency matches the account's, or any bill when the account
   * is in the books' currency — those are the two cases it can measure. Offering the rest would
   * only produce a refusal the user cannot act on.
   */
  readonly payableBills = computed(() => {
    const accountId = this.selectedBankAccountId();
    const account = this.bankAccounts().find((candidate) => candidate.id === accountId);
    if (!account) return [];
    const base = this.baseCurrency();
    return this.bills().filter(
      (bill) =>
        (bill.status === 'OPEN' || bill.status === 'PARTIALLY_PAID') &&
        bill.balance > 0 &&
        (bill.currencyCode === account.currencyCode || account.currencyCode === base),
    );
  });

  readonly totals = signal({ cash: 0, withheld: 0, discount: 0, settled: 0 });

  private readonly dialog = inject(DialogService);
  /** Each account's balance, to warn before a payment overdraws it (QA M-07). */
  private readonly positions = signal<CashPositionRow[]>([]);
  private readonly selectedAccountId = signal<string | null>(null);

  /**
   * What the chosen account holds, in its own currency, or null when unknown — then nothing is
   * claimed either way. A payment of 5,000 left the bank at −2,640 without a word: overdrafts are
   * legitimate (a credit line), so this warns rather than refuses.
   */
  readonly available = computed<{ amount: number; currencyCode: string } | null>(() => {
    const row = this.positions().find((position) => position.bankAccountId === this.selectedAccountId());
    if (!row) return null;
    const amount =
      row.balanceInAccountCurrency ?? (row.currencyCode === this.baseCurrency() ? row.balanceInBaseCurrency : null);
    return amount === null ? null : { amount, currencyCode: row.currencyCode };
  });

  readonly overdraws = computed(() => {
    const available = this.available();
    return available !== null && this.totals().cash > 0 && this.totals().cash > available.amount + 0.005;
  });

  ngOnInit(): void {
    this.form = this.fb.group({
      paymentDate: [todayIso(), [Validators.required]],
      bankAccountId: ['', [Validators.required]],
      reference: [''],
      branchId: [null as string | null],
      lines: this.fb.array([]),
    });

    this.treasury.listBankAccounts().subscribe({
      next: (accounts) => {
        this.bankAccounts.set(accounts);
        const first = accounts.find((account) => account.isActive);
        if (first) {
          this.form.patchValue({ bankAccountId: first.id });
          this.selectedBankAccountId.set(first.id);
        }
        this.preselectBill();
      },
      error: () => this.bankAccounts.set([]),
    });
    this.payables.getVendorBills().subscribe({
      next: (bills) => {
        this.bills.set(bills);
        this.preselectBill();
      },
      error: () => this.bills.set([]),
    });
    this.treasury.cashPosition().subscribe({
      next: (position) => {
        this.baseCurrency.set(position.baseCurrency);
        this.positions.set(position.accounts);
      },
      error: () => this.baseCurrency.set(null),
    });

    this.form.valueChanges.subscribe(() => this.recomputeTotals());
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  /** Changing the account can strand a line the new account cannot settle, so the list resets. */
  onBankAccountChange(account: BankAccount | null): void {
    //  Las líneas seleccionadas pertenecen a la cuenta desde la que se iba a pagar: cambiarla las
    //  invalida, porque la moneda y el saldo disponible son otros.
    this.selectedBankAccountId.set(account?.id ?? '');
    this.lines.clear();
    this.recomputeTotals();
  }

  /**
   * How a bill is recognised: its fiscal number, or — where the jurisdiction has none — its date.
   * The chip read `billNumber` and `vendorName`, which the API never sends, and showed «· · DOP
   * 5,000.00» (QA M-07); the line fell back to a slice of the bill's UUID.
   */
  billReference(bill: VendorBill): string {
    return bill.ncf || this.format.date(bill.date);
  }

  addBill(bill: VendorBill): void {
    if (this.lines.controls.some((line) => line.value.vendorBillId === bill.id)) return;
    this.lines.push(
      this.fb.group({
        vendorBillId: [bill.id],
        // `ncf` and the vendor relation, not `billNumber`/`vendorName` — neither of which the
        // API returns. Both columns rendered blank in the payment picker.
        billNumber: [this.billReference(bill)],
        vendorName: [bill.vendor?.name ?? ''],
        currencyCode: [bill.currencyCode],
        balance: [bill.balance],
        amount: [bill.balance, [Validators.min(0)]],
        taxWithheld: [0, [Validators.min(0)]],
        incomeTaxWithheld: [0, [Validators.min(0)]],
        discount: [0, [Validators.min(0)]],
      }),
    );
    this.recomputeTotals();
  }

  removeLine(index: number): void {
    this.lines.removeAt(index);
    this.recomputeTotals();
  }

  /** Cash paid, plus what we withheld and owe the authority, plus any discount taken. */
  settledBy(line: {
    amount: number;
    taxWithheld: number;
    incomeTaxWithheld: number;
    discount: number;
  }): number {
    return round(
      Number(line.amount || 0) +
        Number(line.taxWithheld || 0) +
        Number(line.incomeTaxWithheld || 0) +
        Number(line.discount || 0),
    );
  }

  /** The server refuses a line settling more than the bill owes; say so before the round trip. */
  exceedsBalance(line: { balance: number } & Parameters<VendorPaymentPage['settledBy']>[0]): boolean {
    return Math.round(this.settledBy(line) * 100) > Math.round(Number(line.balance) * 100);
  }

  private recomputeTotals(): void {
    let cash = 0;
    let withheld = 0;
    let discount = 0;
    let settled = 0;
    for (const line of this.lines.controls) {
      cash += Number(line.value.amount || 0);
      withheld += Number(line.value.taxWithheld || 0) + Number(line.value.incomeTaxWithheld || 0);
      discount += Number(line.value.discount || 0);
      settled += this.settledBy(line.value);
    }
    this.selectedAccountId.set(this.form.get('bankAccountId')?.value || null);
    this.totals.set({
      cash: round(cash),
      withheld: round(withheld),
      discount: round(discount),
      settled: round(settled),
    });
  }

  readonly problems = signal<DraftProblem[]>([]);

  cancel(): void {
    void this.router.navigate(['/accounts-payable/payments']);
  }

  /**
   * Once both the accounts and the bills are known, put the bill the page was opened for on the
   * payment — from an account that can pay it: one in the bill's currency, else one in the books'.
   */
  private preselectBill(): void {
    const billId = this.billId();
    if (this.preselected || !billId || this.bankAccounts().length === 0 || this.bills().length === 0) return;
    const bill = this.bills().find((candidate) => candidate.id === billId);
    if (!bill || bill.balance <= 0 || (bill.status !== 'OPEN' && bill.status !== 'PARTIALLY_PAID')) return;
    const active = this.activeBankAccounts();
    const account =
      active.find((candidate) => candidate.currencyCode === bill.currencyCode) ??
      active.find((candidate) => candidate.currencyCode === this.baseCurrency()) ??
      null;
    if (!account) return;
    this.preselected = true;
    this.form.patchValue({ bankAccountId: account.id });
    this.selectedBankAccountId.set(account.id);
    this.addBill(bill);
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.lines.length === 0) {
      this.form.markAllAsTouched();
      const missing = draftProblems(this.form, {
        paymentDate: 'accounts_payable.payment.payment_date',
        bankAccountId: 'customer_receipts.form.bank_account',
        reference: 'accounting.reconciliation.reference',
      });
      //  Un pago sin ninguna factura elegida no es un campo mal: es que no hay nada que pagar.
      this.problems.set(
        this.lines.length === 0
          ? [...missing, { message: 'accounts_payable.payment.choose_least_one_invoice_complete_payment' }]
          : missing,
      );
      return;
    }
    if (this.lines.controls.some((line) => this.exceedsBalance(line.value))) {
      this.problems.set([{ message: 'accounts_payable.payment.line_settles_more_than_invoice_owes' }]);
      return;
    }

    this.problems.set([]);

    const available = this.available();
    if (this.overdraws() && available) {
      const proceed = await this.dialog.confirm({
        title: 'accounts_payable.payment.overdraft_title',
        message: 'accounts_payable.payment.overdraft_message',
        messageParams: {
          available: this.format.money(available.amount, available.currencyCode),
          after: this.format.money(round(available.amount - this.totals().cash), available.currencyCode),
        },
        confirmText: 'accounts_payable.payment.overdraft_confirm',
        variant: 'danger',
      });
      if (!proceed) return;
    }

    this.saving.set(true);
    const raw = this.form.getRawValue();

    this.payables
      .payBills({
        paymentDate: raw.paymentDate,
        bankAccountId: raw.bankAccountId,
        reference: raw.reference || undefined,
        branchId: raw.branchId || undefined,
        lines: (raw.lines as Record<string, string | number>[]).map((line) => ({
          vendorBillId: String(line['vendorBillId']),
          amount: Number(line['amount']),
          taxWithheld: Number(line['taxWithheld']) || 0,
          incomeTaxWithheld: Number(line['incomeTaxWithheld']) || 0,
          discount: Number(line['discount']) || 0,
        })),
      })
      .subscribe({
        next: (batch) => {
          this.saving.set(false);
          this.form.markAsPristine();
          this.tab?.markClean();
          this.notifications.showSuccess('accounts_payable.payment.payment_recorded_number', { number: batch.number });
          // The payment just made, as a document: its number, what it settled, and its void.
          const route = `/accounts-payable/payments/${batch.id}`;
          if (this.tab) this.tab.replaceRoute(route, { title: batch.number });
          else void this.router.navigate([route]);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'accounts_payable.payment.payment_could_not_recorded');
        },
      });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
