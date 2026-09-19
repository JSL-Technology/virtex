import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { CustomerAdvance, CustomerReceiptsService } from '../../../core/services/customer-receipts';
import { InvoicesService, Invoice } from '../../../core/services/invoices';
import { CustomersService } from '../../../core/api/customers.service';
import { Customer } from '../../../core/models/customer.model';
import { BankAccount, TreasuryService } from '../../../core/api/treasury.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxAmountComponent } from '../../../shared/components/amount';

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
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    DraftShellComponent,
    ...VX_FORM_A11Y, VxAmountComponent],
  templateUrl: './form.page.html',
  styleUrls: ['./form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerReceiptFormPage implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  /** The chips add a document to the receipt; the icon is what says so. */
  protected readonly AddIcon = Plus;


  private readonly fb = inject(FormBuilder);
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
  /** What this customer has already paid ahead, per currency. */
  readonly advances = signal<CustomerAdvance[]>([]);

  readonly activeBankAccounts = computed(() =>
    this.bankAccounts().filter((account) => account.isActive),
  );

  /**
   * What may be drawn on this receipt: the advance held in the receipt's own currency.
   *
   * Money held in pesos cannot settle a dollar invoice at a rate nobody has stated, so the offer
   * is restricted to the currency the funds are actually in — which is also the rule the server
   * enforces.
   */
  readonly availableAdvance = computed(() => {
    const currency = this.currency();
    return this.advances().find((advance) => advance.currencyCode === currency)?.amount ?? 0;
  });

  /** The receipt's currency, as a signal so the available advance follows the bank account. */
  private readonly currency = signal('');

  ngOnInit(): void {
    this.form = this.fb.group({
      customerId: ['', [Validators.required]],
      paymentDate: [todayIso(), [Validators.required]],
      bankAccountId: ['', [Validators.required]],
      // Zero cash is legitimate: a receipt funded entirely from an advance the customer already
      // paid. What may not be zero is cash *and* advance together, which `save()` checks.
      amountReceived: [0, [Validators.required, Validators.min(0)]],
      advanceApplied: [0, [Validators.min(0)]],
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
          this.currency.set(first.currencyCode);
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
    if (!account) return;
    this.form.patchValue({ currencyCode: account.currencyCode });
    this.currency.set(account.currencyCode);
    // What was on offer was the old currency's advance; keeping it would post a draw the server
    // will refuse.
    this.form.patchValue({ advanceApplied: 0 });
  }

  /** Only what the customer still owes can be collected, so only that is offered. */
  onCustomerChange(customerId: string): void {
    this.lines.clear();
    this.openInvoices.set([]);
    this.advances.set([]);
    this.form.patchValue({ advanceApplied: 0 });
    if (!customerId) return;

    this.invoicesApi.getInvoices({ customerId, limit: 200 }).subscribe({
      next: (page) => {
        // A draft is not a receivable. Offering one led to a receipt the server refuses, with the
        // user left staring at an invoice the page had just shown them as collectible.
        this.openInvoices.set(
          page.items.filter(
            (invoice) => invoice.balance > 0 && COLLECTIBLE.includes(invoice.status),
          ),
        );
      },
      error: () => this.openInvoices.set([]),
    });

    // Money the customer already left on account: it settles an invoice without them paying twice.
    this.receipts.advances(customerId).subscribe({
      next: (data) => this.advances.set(data),
      error: () => this.advances.set([]),
    });
  }

  /** Fill the draw with everything on account, up to what this receipt still needs. */
  applyFullAdvance(): void {
    const applied = this.totals().applied;
    const received = Number(this.form.get('amountReceived')?.value || 0);
    const needed = round(Math.max(applied - received, 0));
    this.form.patchValue({ advanceApplied: Math.min(needed, this.availableAdvance()) });
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
    const drawn = Number(this.form.get('advanceApplied')?.value || 0);
    this.totals.set({ applied, unapplied: round(received + drawn - applied) });
  }

  /** Qué falta antes de guardar. Los campos no llevan `id`; el armazón los localiza por control. */
  readonly problems = signal<DraftProblem[]>([]);

  cancel(): void {
    void this.router.navigate(['/customer-receipts']);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.problems.set(
        draftProblems(this.form, {
          customerId: 'customer_receipts.list.customer',
          paymentDate: 'customer_receipts.list.date',
          bankAccountId: 'customer_receipts.form.bank_account',
          amountReceived: 'customer_receipts.form.amount_received',
          currencyCode: 'treasury.currency',
          reference: 'accounting.reconciliation.reference',
        }),
      );
      return;
    }

    this.problems.set([]);
    const raw0 = this.form.getRawValue();
    const drawn = Number(raw0.advanceApplied || 0);
    if (Number(raw0.amountReceived || 0) + drawn <= 0) {
      this.notifications.showError('customer_receipts.form.enter_amount_received_advance_apply');
      return;
    }
    if (drawn > this.availableAdvance()) {
      this.notifications.showError('customer_receipts.form.advance_apply_exceeds_what_customer_holds');
      return;
    }
    if (this.totals().unapplied < 0) {
      this.notifications.showError('customer_receipts.form.what_applied_invoices_exceeds_amount_received');
      return;
    }
    // Taking money off account only to put it straight back is not a transaction, and the server
    // refuses it — better said here, before the round trip.
    if (drawn > 0 && this.totals().unapplied > 0) {
      this.notifications.showError('customer_receipts.form.you_drawing_more_advance_than_receipt');
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
        advanceApplied: drawn || undefined,
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
          this.notifications.showSuccess('customer_receipts.form.collection_recorded');
          //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
          //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
          //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
          void this.router.navigate(['/customer-receipts']).then(() => this.tab?.close());
        },
        error: (error: { error?: { message?: string } }) => {
          this.saving.set(false);
          const message = error?.error?.message;
          this.notifications.showError(
            typeof message === 'string' ? message : 'customer_receipts.form.collection_could_not_recorded',
          );
        },
      });
  }
}

/** The statuses a receipt may actually be applied to; the server accepts no others. */
const COLLECTIBLE = ['Pending', 'Partially Paid'];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
