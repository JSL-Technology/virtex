import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { CustomerReceiptsService } from '../../../core/services/customer-receipts';
import { InvoicesService, Invoice } from '../../../core/services/invoices';
import { CustomersService } from '../../../core/api/customers.service';
import { Customer } from '../../../core/models/customer.model';
import { BankAccount, TreasuryService } from '../../../core/api/treasury.service';
import { NotificationService } from '../../../core/services/notification';

/**
 * Recording a collection from a customer.
 *
 * ## What this page was
 *
 * A form with four fields — customer, date, amount, notes — an empty `invoicesToApply` array with
 * the comment "In a real app, this would be a more complex control to select invoices", and a save
 * method whose body was `console.log('La creación de recibos aún no está conectada al backend.')`.
 * It could not record anything.
 *
 * What a collection actually needs, and what this now carries: the bank account the funds landed
 * in, so the movement can be reconciled against the statement that shows it; the currency, so a
 * collection against a foreign-currency invoice is measured and its exchange difference realised;
 * the withholdings the customer deducted and paid to the authority on our behalf, which settle the
 * receivable without cash arriving; a settlement discount; and an amount received that is allowed
 * to exceed what is applied, so an advance or an overpayment has somewhere to go.
 *
 * The unapplied figure is shown while the user types because it is the one number they cannot
 * infer: it is what the receipt will carry as a customer credit, and a receipt that lands there by
 * accident is a mistake worth catching before it is posted, not after.
 */
@Component({
  selector: 'app-customer-receipt-form-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
  ],
  templateUrl: './form.page.html',
  styleUrls: ['./form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerReceiptFormPage implements OnInit {
  protected readonly BackIcon = ChevronLeft;

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly receipts = inject(CustomerReceiptsService);
  private readonly invoicesApi = inject(InvoicesService);
  private readonly customersApi = inject(CustomersService);
  private readonly treasury = inject(TreasuryService);
  private readonly notifications = inject(NotificationService);

  form!: FormGroup;
  readonly customers = signal<Customer[]>([]);
  readonly bankAccounts = signal<BankAccount[]>([]);
  readonly openInvoices = signal<Invoice[]>([]);
  readonly saving = signal(false);
  /** Recomputed on every keystroke, so the arithmetic is visible before it is committed. */
  readonly totals = signal({ applied: 0, unapplied: 0 });

  readonly activeBankAccounts = computed(() =>
    this.bankAccounts().filter((account) => account.isActive),
  );

  ngOnInit(): void {
    this.form = this.fb.group({
      customerId: ['', [Validators.required]],
      paymentDate: [todayIso(), [Validators.required]],
      bankAccountId: ['', [Validators.required]],
      amountReceived: [0, [Validators.required, Validators.min(0.01)]],
      currencyCode: ['', [Validators.required]],
      paymentMethod: ['BANK_TRANSFER'],
      reference: [''],
      lines: this.fb.array([]),
    });

    this.customersApi.getCustomers().subscribe({
      next: (data) => this.customers.set(data),
      error: () => this.customers.set([]),
    });
    this.treasury.listBankAccounts().subscribe({
      next: (data) => {
        this.bankAccounts.set(data);
        const first = data.find((account) => account.isActive);
        if (first) {
          this.form.patchValue({ bankAccountId: first.id, currencyCode: first.currencyCode });
        }
      },
      error: () => this.bankAccounts.set([]),
    });

    this.form.valueChanges.subscribe(() => this.recomputeTotals());
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  /**
   * The account's currency decides the receipt's.
   *
   * The server refuses a receipt whose currency the account cannot receive — it would need a rate
   * nobody has stated — so following the account is the only combination that always posts.
   */
  onBankAccountChange(bankAccountId: string): void {
    const account = this.bankAccounts().find((candidate) => candidate.id === bankAccountId);
    if (account) this.form.patchValue({ currencyCode: account.currencyCode });
  }

  /** Only what the customer still owes can be collected, so only that is offered. */
  onCustomerChange(customerId: string): void {
    this.lines.clear();
    this.openInvoices.set([]);
    if (!customerId) return;

    this.invoicesApi.getInvoices({ customerId, limit: 200 }).subscribe({
      next: (page) => {
        this.openInvoices.set(page.items.filter((invoice) => invoice.balance > 0));
      },
      error: () => this.openInvoices.set([]),
    });
  }

  addInvoice(invoice: Invoice): void {
    if (this.lines.controls.some((line) => line.value.invoiceId === invoice.id)) return;
    this.lines.push(
      this.fb.group({
        invoiceId: [invoice.id],
        invoiceNumber: [invoice.invoiceNumber],
        balance: [invoice.balance],
        amount: [invoice.balance, [Validators.min(0)]],
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

  /**
   * What each line settles: cash, plus what the customer withheld, plus any discount granted.
   *
   * Withholding relieves the invoice without cash arriving — the customer paid it to the tax
   * authority on our behalf — which is exactly what the previous model could not express, leaving
   * the balance permanently short by the withheld amount.
   */
  settledBy(line: { amount: number; taxWithheld: number; incomeTaxWithheld: number; discount: number }): number {
    return round(
      Number(line.amount || 0) +
        Number(line.taxWithheld || 0) +
        Number(line.incomeTaxWithheld || 0) +
        Number(line.discount || 0),
    );
  }

  private recomputeTotals(): void {
    const applied = round(
      this.lines.controls.reduce((sum, line) => sum + Number(line.value.amount || 0), 0),
    );
    const received = Number(this.form.get('amountReceived')?.value || 0);
    this.totals.set({ applied, unapplied: round(received - applied) });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showError('CUSTOMER_RECEIPTS.FORM.FAVOR_COMPLETA_TODOS_CAMPOS_REQUERIDOS');
      return;
    }
    if (this.totals().unapplied < 0) {
      this.notifications.showError('CUSTOMER_RECEIPTS.FORM.APLICADO_EXCEDE_RECIBIDO');
      return;
    }

    this.saving.set(true);
    const raw = this.form.getRawValue();

    this.receipts
      .create({
        customerId: raw.customerId,
        paymentDate: raw.paymentDate,
        bankAccountId: raw.bankAccountId,
        amountReceived: Number(raw.amountReceived),
        currencyCode: raw.currencyCode,
        paymentMethod: raw.paymentMethod,
        reference: raw.reference || undefined,
        lines: (raw.lines as Record<string, number | string>[]).map((line) => ({
          invoiceId: String(line['invoiceId']),
          amount: Number(line['amount']),
          taxWithheld: Number(line['taxWithheld']) || 0,
          incomeTaxWithheld: Number(line['incomeTaxWithheld']) || 0,
          discount: Number(line['discount']) || 0,
        })),
      })
      .subscribe({
        next: () => {
          this.notifications.showSuccess('CUSTOMER_RECEIPTS.FORM.RECIBO_REGISTRADO');
          this.router.navigate(['..'], { relativeTo: this.route });
        },
        error: (error: { error?: { message?: string } }) => {
          this.saving.set(false);
          const message = error?.error?.message;
          this.notifications.showError(
            typeof message === 'string' ? message : 'CUSTOMER_RECEIPTS.FORM.NO_SE_PUDO_GUARDAR',
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
