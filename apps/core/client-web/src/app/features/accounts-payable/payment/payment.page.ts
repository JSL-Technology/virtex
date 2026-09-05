import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { BankAccount, TreasuryService } from '../../../core/api/treasury.service';
import { NotificationService } from '../../../core/services/notification';

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
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
  ],
  templateUrl: './payment.page.html',
  styleUrls: ['./payment.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorPaymentPage implements OnInit {
  protected readonly BackIcon = ChevronLeft;

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly payables = inject(AccountsPayableService);
  private readonly treasury = inject(TreasuryService);
  private readonly notifications = inject(NotificationService);

  form!: FormGroup;
  readonly bankAccounts = signal<BankAccount[]>([]);
  /**
   * The chosen account, mirrored out of the form.
   *
   * A `computed` cannot read a reactive-forms value: the control is not a signal, so the
   * derivation would be evaluated once and never again, and the list of payable bills would keep
   * showing whatever the first account allowed.
   */
  readonly selectedBankAccountId = signal<string>('');
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

  ngOnInit(): void {
    this.form = this.fb.group({
      paymentDate: [todayIso(), [Validators.required]],
      bankAccountId: ['', [Validators.required]],
      reference: [''],
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
      },
      error: () => this.bankAccounts.set([]),
    });
    this.payables.getVendorBills().subscribe({
      next: (bills) => this.bills.set(bills),
      error: () => this.bills.set([]),
    });
    this.treasury.cashPosition().subscribe({
      next: (position) => this.baseCurrency.set(position.baseCurrency),
      error: () => this.baseCurrency.set(null),
    });

    this.form.valueChanges.subscribe(() => this.recomputeTotals());
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  /** Changing the account can strand a line the new account cannot settle, so the list resets. */
  onBankAccountChange(bankAccountId: string): void {
    this.form.patchValue({ bankAccountId }, { emitEvent: false });
    this.selectedBankAccountId.set(bankAccountId);
    this.lines.clear();
    this.recomputeTotals();
  }

  addBill(bill: VendorBill): void {
    if (this.lines.controls.some((line) => line.value.vendorBillId === bill.id)) return;
    this.lines.push(
      this.fb.group({
        vendorBillId: [bill.id],
        // `ncf` and the vendor relation, not `billNumber`/`vendorName` — neither of which the
        // API returns. Both columns rendered blank in the payment picker.
        billNumber: [bill.ncf ?? bill.id.slice(0, 8)],
        vendorName: [bill.vendor?.name ?? bill.vendorId],
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
    this.totals.set({
      cash: round(cash),
      withheld: round(withheld),
      discount: round(discount),
      settled: round(settled),
    });
  }

  save(): void {
    if (this.form.invalid || this.lines.length === 0) {
      this.form.markAllAsTouched();
      this.notifications.showError('ACCOUNTS_PAYABLE.PAYMENT.SELECCIONE_FACTURAS');
      return;
    }
    if (this.lines.controls.some((line) => this.exceedsBalance(line.value))) {
      this.notifications.showError('ACCOUNTS_PAYABLE.PAYMENT.EXCEDE_SALDO');
      return;
    }

    this.saving.set(true);
    const raw = this.form.getRawValue();

    this.payables
      .payBills({
        paymentDate: raw.paymentDate,
        bankAccountId: raw.bankAccountId,
        reference: raw.reference || undefined,
        lines: (raw.lines as Record<string, string | number>[]).map((line) => ({
          vendorBillId: String(line['vendorBillId']),
          amount: Number(line['amount']),
          taxWithheld: Number(line['taxWithheld']) || 0,
          incomeTaxWithheld: Number(line['incomeTaxWithheld']) || 0,
          discount: Number(line['discount']) || 0,
        })),
      })
      .subscribe({
        next: () => {
          this.notifications.showSuccess('ACCOUNTS_PAYABLE.PAYMENT.PAGO_REGISTRADO');
          this.router.navigate(['..'], { relativeTo: this.route });
        },
        error: (error: { error?: { message?: string } }) => {
          this.saving.set(false);
          const message = error?.error?.message;
          this.notifications.showError(
            typeof message === 'string' ? message : 'ACCOUNTS_PAYABLE.PAYMENT.NO_SE_PUDO_PAGAR',
          );
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
