import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, map, startWith } from 'rxjs';
import { FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { VxAmountComponent } from '../../../shared/components/amount';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { chargeableExpenseAccounts } from '../../../core/services/account-selection';
import { Account } from '../../../core/models/account.model';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';

const round2 = (value: number): number => Math.round(value * 100) / 100;
const todayIso = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * A debit note against one supplier bill (audit H-19): what it is reduced by, why, on which day,
 * which account takes the other side — the one the bill charged — and how much of it is input tax
 * given back. In the Dominican Republic the supplier answers with a credit note of its own (NCF
 * type 04); its number is recorded here so the 606 can pair the two.
 *
 * Posted on save: a note is corrected by voiding it, never by editing.
 */
@Component({
  selector: 'app-vendor-debit-note-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, DraftShellComponent, VxDateFieldComponent, VxAmountComponent],
  templateUrl: './debit-note-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorDebitNoteFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly payables = inject(AccountsPayableService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  /** `?billId=` — from the bill's own page. */
  readonly billId = input<string>();

  readonly form = this.fb.group({
    vendorBillId: ['', [Validators.required]],
    date: [todayIso(), [Validators.required]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    taxAmount: [0 as number | null, [Validators.min(0)]],
    expenseAccountId: ['', [Validators.required]],
    ncf: ['', [Validators.pattern(/^[A-Za-z0-9]{11,19}$/)]],
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });

  readonly bills = signal<VendorBill[]>([]);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);

  private readonly selectedBillId = toSignal(
    this.form.controls.vendorBillId.valueChanges.pipe(startWith(this.form.controls.vendorBillId.value)),
    { initialValue: '' },
  );
  readonly bill = computed(() => this.bills().find((candidate) => candidate.id === this.selectedBillId()) ?? null);
  /** Input tax the bill took as a credit: the most a note can give back. */
  readonly deductibleTax = computed(() => {
    const bill = this.bill();
    return bill ? round2(bill.taxAmount - bill.taxToCost - bill.taxProportional) : 0;
  });

  protected readonly billLabel = (bill: VendorBill): string =>
    `${bill.ncf || bill.date} · ${bill.vendor?.name ?? ''}`.trim();
  protected readonly billValue = (bill: VendorBill): string => bill.id;
  protected readonly billSearchText = (bill: VendorBill): string => `${bill.ncf ?? ''} ${bill.vendor?.name ?? ''} ${bill.date}`;

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => chargeableExpenseAccounts(list ?? [])));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    // The counterpart defaults to the account the bill charged: a return undoes that charge.
    // Listening before the bills load, so the bill the page opens on gets its default too.
    this.form.controls.vendorBillId.valueChanges.subscribe((id) => {
      if (!id || this.form.controls.expenseAccountId.value) return;
      this.payables.getVendorBillById(id).subscribe({
        next: (full) => {
          const charged = full.lines?.find((line) => line.expenseAccountId)?.expenseAccountId;
          if (charged && !this.form.controls.expenseAccountId.value) {
            this.form.patchValue({ expenseAccountId: charged });
          }
        },
      });
    });
    this.payables.getVendorBills().subscribe({
      next: (bills) => {
        this.bills.set(bills.filter((bill) => (bill.status === 'OPEN' || bill.status === 'PARTIALLY_PAID') && bill.balance > 0));
        const preset = this.billId();
        if (preset) this.form.patchValue({ vendorBillId: preset });
      },
      error: () => this.bills.set([]),
    });
  }

  save(): void {
    if (!this.validate()) return;
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.payables
      .createDebitNote({
        vendorBillId: raw.vendorBillId as string,
        date: raw.date as string,
        amount: round2(Number(raw.amount)),
        taxAmount: round2(Number(raw.taxAmount) || 0),
        expenseAccountId: raw.expenseAccountId as string,
        ncf: (raw.ncf ?? '').trim().toUpperCase() || undefined,
        reason: (raw.reason ?? '').trim(),
      })
      .subscribe({
        next: (note) => {
          this.saving.set(false);
          this.form.markAsPristine();
          this.tab?.markClean();
          this.notifications.showSuccess('accounts_payable.debit_notes.posted', { number: note.number });
          const route = `/accounts-payable/debit-notes/${note.id}`;
          if (this.tab) this.tab.replaceRoute(route, { title: note.number });
          else void this.router.navigateByUrl(this.organization.urlFor(route));
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'accounts_payable.debit_notes.save_failed');
        },
      });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounts-payable/debit-notes'));
  }

  private validate(): boolean {
    const extra: DraftProblem[] = [];
    const bill = this.bill();
    const amount = Number(this.form.controls.amount.value) || 0;
    const tax = Number(this.form.controls.taxAmount.value) || 0;
    if (bill && amount - bill.balance > 0.005) {
      extra.push({ message: 'accounts_payable.debit_notes.exceeds_balance' });
    }
    if (tax > 0 && tax >= amount) {
      extra.push({ message: 'accounts_payable.debit_notes.tax_not_below_amount' });
    }
    if (bill && tax - this.deductibleTax() > 0.005) {
      extra.push({ message: 'accounts_payable.debit_notes.tax_exceeds_bill' });
    }
    if (this.form.invalid || extra.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, {
          vendorBillId: 'accounts_payable.debit_notes.bill',
          date: 'accounts_payable.debit_notes.date',
          amount: 'accounts_payable.debit_notes.amount',
          taxAmount: 'accounts_payable.debit_notes.tax_amount',
          expenseAccountId: 'accounts_payable.debit_notes.counterpart',
          ncf: 'accounts_payable.debit_notes.ncf',
          reason: 'accounts_payable.debit_notes.reason',
        }),
        ...extra,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }
}
