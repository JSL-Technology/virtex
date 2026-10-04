import { ChangeDetectionStrategy, Component, DestroyRef, Input, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, Subject, debounceTime, switchMap, tap, catchError, of } from 'rxjs';
import { FORMAT_PIPES, LocaleStore } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../../shared/components/badge';
import { VxAmountComponent } from '../../../../shared/components/amount';
import { VxDateFieldComponent, dateOrder } from '../../../../shared/components/date';
import { VX_SELECT } from '../../../../shared/components/select';
import { PercentInputDirective } from '../../../../shared/directives/percent-input.directive';
import { CustomersService } from '../../../../core/api/customers.service';
import { CurrenciesService } from '../../../../core/api/currencies.service';
import { InventoryService } from '../../../../core/api/inventory.service';
import { Customer } from '../../../../core/models/customer.model';
import { Product } from '../../../../core/models/product.model';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { InvoicePreview } from '../../../../core/services/invoices';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { Quote, QuoteInput, QuotesService } from '../data/quotes.service';
import { QUOTE_TONE } from '../list/quotes.page';

const DEFAULT_VALIDITY_DAYS = 15;

/**
 * Writing a quote and taking it through its life (QA M-09).
 *
 * A draft is edited freely; its totals — tax included — are asked of the server as the lines
 * change, from the same engine that will price the invoice, so the figure the customer accepts
 * is the figure they are billed. Once it has gone out it is no longer edited: it is accepted,
 * rejected with the customer's reason, cancelled, or duplicated into a new draft. An accepted
 * quote becomes a draft invoice in one step, and the quote then links to it.
 */
@Component({
  selector: 'app-quote-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    ...VX_SELECT,
    DraftShellComponent,
    VxBadgeComponent,
    VxAmountComponent,
    VxDateFieldComponent,
    PercentInputDirective,
  ],
  templateUrl: './quote-form.page.html',
  styleUrls: ['./quote-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuoteFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly quotes = inject(QuotesService);
  private readonly customersApi = inject(CustomersService);
  private readonly inventory = inject(InventoryService);
  private readonly currencies = inject(CurrenciesService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly locale = inject(LocaleStore);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  @Input() id?: string;

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  form!: FormGroup;
  readonly current = signal<Quote | null>(null);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  readonly totals = signal<InvoicePreview | null>(null);
  readonly totalsPending = signal(false);
  readonly currencyCodes = signal<string[]>([]);
  readonly currencyCode = signal<string>('');
  private readonly previewRequests = new Subject<QuoteInput>();

  readonly status = computed(() => this.current()?.status ?? null);
  readonly editable = computed(() => !this.current() || this.status() === 'DRAFT');
  readonly expired = computed(() => !!this.current()?.expired);
  readonly canSend = computed(() => this.status() === 'DRAFT' && !this.expired());
  readonly canAccept = computed(() => (this.status() === 'DRAFT' || this.status() === 'SENT') && !this.expired());
  readonly canReject = computed(() => ['DRAFT', 'SENT', 'ACCEPTED'].includes(this.status() ?? ''));
  readonly canCancel = computed(() => this.status() === 'DRAFT' || this.status() === 'SENT');
  readonly canConvert = computed(() => this.status() === 'ACCEPTED');
  readonly canDuplicate = computed(() => !!this.current());
  readonly invoiceLink = computed(() => {
    const invoiceId = this.current()?.invoiceId;
    return invoiceId ? this.organization.urlFor(`/invoices/${invoiceId}`) : null;
  });

  readonly statusTone = computed<VxTone>(() => {
    const quote = this.current();
    if (!quote) return 'draft';
    return quote.expired ? 'warning' : QUOTE_TONE[quote.status];
  });
  readonly statusKey = computed(() => {
    const quote = this.current();
    if (!quote) return '';
    return quote.expired ? 'sales.quotes.status.expired' : `sales.quotes.status.${quote.status.toLowerCase()}`;
  });

  readonly currencyOptions = computed(() => {
    const codes = new Set([this.locale.currency(), ...this.currencyCodes()]);
    const own = this.current()?.currencyCode;
    if (own) codes.add(own);
    return [...codes];
  });

  // ── pickers ────────────────────────────────────────────────────────────────

  protected readonly searchCustomers = (query: string, limit: number): Observable<Customer[]> =>
    this.customersApi.searchCustomers(query, limit);
  protected readonly resolveCustomer = (id: string): Observable<Customer> => this.customersApi.getCustomerById(id);
  protected readonly customerName = (customer: Customer): string => customer.companyName;
  protected readonly customerId = (customer: Customer): string => customer.id;

  protected readonly searchProducts = (query: string, limit: number): Observable<Product[]> =>
    this.inventory.searchProducts(query, limit);
  protected readonly resolveProduct = (id: string): Observable<Product> => this.inventory.getProductById(id);
  protected readonly productName = (product: Product): string => product.name;
  protected readonly productId = (product: Product): string => product.id;
  protected readonly identity = (code: string): string => code;

  ngOnInit(): void {
    const today = isoToday();
    this.form = this.fb.group(
      {
        customerId: ['', [Validators.required]],
        currencyCode: [this.locale.currency(), [Validators.required]],
        issueDate: [today, [Validators.required]],
        expiryDate: [addDays(today, DEFAULT_VALIDITY_DAYS), [Validators.required]],
        documentDiscountRate: [0, [Validators.min(0), Validators.max(0.999999)]],
        notes: [''],
        lines: this.fb.array([]),
      },
      { validators: dateOrder('issueDate', 'expiryDate') },
    );
    this.currencyCode.set(this.locale.currency());
    this.form.get('currencyCode')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((code: string) => this.currencyCode.set(code));

    this.currencies.getCurrencies().subscribe({
      next: (all) => this.currencyCodes.set(all.map((currency) => currency.code)),
      error: () => this.currencyCodes.set([]),
    });

    // `switchMap` drops the answer to a superseded question; an unpriceable form shows no figures
    // rather than stale ones — the reason surfaces on save.
    this.previewRequests
      .pipe(
        debounceTime(300),
        switchMap((input) => this.quotes.preview(input).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((preview) => {
        this.totals.set(preview);
        this.totalsPending.set(false);
      });
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.requestPreview());

    if (this.id) {
      this.quotes.get(this.id).subscribe({
        next: (quote) => this.load(quote),
        error: (error: unknown) => this.notifications.showHttpError(error, 'sales.quotes.load_failed'),
      });
    } else {
      this.addLine();
    }
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  addLine(): void {
    this.lines.push(
      this.fb.group({
        productId: [''],
        description: ['', [Validators.required, Validators.maxLength(500)]],
        quantity: [1, [Validators.required, Validators.min(0.000001)]],
        unitPrice: [0, [Validators.required, Validators.min(0)]],
        discountRate: [0, [Validators.min(0), Validators.max(0.999999)]],
      }),
    );
  }

  removeLine(index: number): void {
    this.lines.removeAt(index);
  }

  /** A product fills the line with its name and selling price; what was typed stays. */
  onProductChange(index: number, product: Product | null): void {
    if (!product) return;
    const line = this.lines.at(index);
    line.patchValue({
      description: line.value.description || product.name,
      unitPrice: Number((product as { price?: number }).price) || 0,
    });
  }

  lineTax(index: number): number | null {
    return this.totals()?.lines[index]?.taxAmount ?? null;
  }

  lineSubtotal(index: number): number | null {
    return this.totals()?.lines[index]?.subtotal ?? null;
  }

  save(): void {
    if (this.form.invalid || this.lines.length === 0) {
      this.form.markAllAsTouched();
      const problems = draftProblems(this.form, {
        customerId: 'sales.quotes.customer',
        issueDate: 'sales.quotes.issue_date',
        expiryDate: 'sales.quotes.expiry_date',
        description: 'sales.quotes.description',
        quantity: 'sales.quotes.quantity',
        unitPrice: 'sales.quotes.unit_price',
      });
      if (this.lines.length === 0) problems.push({ message: 'sales.quotes.lines_required' });
      this.problems.set(problems);
      return;
    }
    this.problems.set([]);
    const input = this.input();
    const creating = !this.current();
    this.saving.set(true);
    const request = creating ? this.quotes.create(input) : this.quotes.update(this.current()!.id, input);
    request.subscribe({
      next: (quote) => {
        this.saving.set(false);
        this.notifications.showSuccess('sales.quotes.saved', { number: quote.quoteNumber });
        if (creating && this.tab) {
          this.tab.replaceRoute(`/quotes/${quote.id}/edit`, { title: quote.quoteNumber });
          return;
        }
        this.load(quote);
      },
      error: (error: unknown) => this.fail(error, 'sales.quotes.save_failed'),
    });
  }

  markSent(): void {
    this.act(this.quotes.markSent(this.current()!.id), 'sales.quotes.sent');
  }

  accept(): void {
    this.act(this.quotes.accept(this.current()!.id), 'sales.quotes.accepted');
  }

  async reject(): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'sales.quotes.reject_title',
      message: 'sales.quotes.reject_message',
      placeholder: 'sales.quotes.reject_placeholder',
      minLength: 3,
      tooShort: 'sales.quotes.reason_too_short',
      variant: 'danger',
    });
    if (!reason) return;
    this.act(this.quotes.reject(this.current()!.id, reason), 'sales.quotes.rejected');
  }

  async cancelQuote(): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'sales.quotes.cancel_title',
      message: 'sales.quotes.cancel_message',
      placeholder: 'sales.quotes.reject_placeholder',
      variant: 'danger',
    });
    if (reason === null) return;
    this.act(this.quotes.cancel(this.current()!.id, reason || undefined), 'sales.quotes.cancelled');
  }

  duplicate(): void {
    this.saving.set(true);
    this.quotes.duplicate(this.current()!.id).subscribe({
      next: (copy) => {
        this.saving.set(false);
        this.notifications.showSuccess('sales.quotes.duplicated', { number: copy.quoteNumber });
        void this.router.navigateByUrl(this.organization.urlFor(`/quotes/${copy.id}/edit`));
      },
      error: (error: unknown) => this.fail(error, 'sales.quotes.save_failed'),
    });
  }

  async convert(): Promise<void> {
    const quote = this.current();
    if (!quote) return;
    const confirmed = await this.dialog.confirm({
      title: 'sales.quotes.convert_title',
      message: 'sales.quotes.convert_message',
      messageParams: { number: quote.quoteNumber },
      confirmText: 'sales.quotes.convert',
    });
    if (!confirmed) return;
    this.saving.set(true);
    this.quotes.convertToInvoice(quote.id).subscribe({
      next: (invoice) => {
        this.saving.set(false);
        this.notifications.showSuccess('sales.quotes.converted', { number: quote.quoteNumber });
        void this.router.navigateByUrl(this.organization.urlFor(`/invoices/${invoice.id}`));
      },
      error: (error: unknown) => this.fail(error, 'sales.quotes.convert_failed'),
    });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/quotes'));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private input(): QuoteInput {
    const raw = this.form.getRawValue();
    return {
      customerId: raw.customerId,
      issueDate: raw.issueDate,
      expiryDate: raw.expiryDate,
      currencyCode: raw.currencyCode || undefined,
      documentDiscountRate: Number(raw.documentDiscountRate) || undefined,
      notes: raw.notes?.trim() || undefined,
      lines: (raw.lines as Record<string, unknown>[]).map((line) => ({
        productId: (line['productId'] as string) || undefined,
        description: String(line['description'] ?? '').trim(),
        quantity: Number(line['quantity']),
        unitPrice: Number(line['unitPrice']),
        discountRate: Number(line['discountRate']) || undefined,
      })),
    };
  }

  private requestPreview(): void {
    if (!this.editable()) return;
    const input = this.input();
    const priceable =
      !!input.customerId &&
      input.lines.length > 0 &&
      input.lines.every((line) => line.description && line.quantity > 0 && line.unitPrice >= 0);
    if (!priceable) {
      this.totals.set(null);
      return;
    }
    this.totalsPending.set(true);
    this.previewRequests.next(input);
  }

  private act(request: Observable<Quote>, successKey: string): void {
    this.saving.set(true);
    request.pipe(tap(() => this.saving.set(false))).subscribe({
      next: (quote) => {
        this.notifications.showSuccess(successKey, { number: quote.quoteNumber });
        this.load(quote);
      },
      error: (error: unknown) => this.fail(error, 'sales.quotes.action_failed'),
    });
  }

  private fail(error: unknown, fallbackKey: string): void {
    this.saving.set(false);
    this.notifications.showHttpError(error, fallbackKey);
  }

  private load(quote: Quote): void {
    this.current.set(quote);
    this.tab?.setTitle(quote.quoteNumber);
    this.lines.clear({ emitEvent: false });
    for (const line of quote.lines ?? []) {
      this.lines.push(
        this.fb.group({
          productId: [line.product?.id ?? ''],
          description: [line.description, [Validators.required, Validators.maxLength(500)]],
          quantity: [Number(line.quantity), [Validators.required, Validators.min(0.000001)]],
          unitPrice: [Number(line.unitPrice), [Validators.required, Validators.min(0)]],
          discountRate: [Number(line.discountRate) || 0, [Validators.min(0), Validators.max(0.999999)]],
        }),
        { emitEvent: false },
      );
    }
    this.form.patchValue(
      {
        customerId: quote.customer?.id ?? '',
        currencyCode: quote.currencyCode,
        issueDate: String(quote.issueDate).slice(0, 10),
        expiryDate: String(quote.expiryDate).slice(0, 10),
        documentDiscountRate: Number(quote.documentDiscountRate) || 0,
        notes: quote.notes ?? '',
      },
      { emitEvent: false },
    );
    this.currencyCode.set(quote.currencyCode);
    // The stored figures, not a recomputation: they are what the customer was shown.
    this.totals.set({
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      tax: quote.taxTotal,
      total: quote.total,
      lines: (quote.lines ?? []).map((line) => ({ subtotal: line.lineTotal, taxAmount: line.taxAmount, taxRate: line.taxRate })),
    } as InvoicePreview);
    if (this.editable()) this.form.enable({ emitEvent: false });
    else this.form.disable({ emitEvent: false });
    this.form.markAsPristine();
    this.tab?.markClean();
  }
}

function isoToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}
