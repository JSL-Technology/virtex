import { FormsModule } from '@angular/forms';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Search, X, Plus, Minus, Trash2, CreditCard, ShoppingCart, Banknote, Landmark, Shuffle, Printer, CheckCircle2 } from 'lucide-angular';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Product } from '../../../core/models/product.model';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { InvoicesService } from '../../../core/services/invoices';
import { InventoryService } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import { PosPaymentPayload, PosSale, PosService } from './pos.service';
import { FormatService } from '@virteex/shared/ui-i18n';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

/**
 * Web-based POS terminal embedded in the management console.
 *
 * This is the in-browser selling interface for staff who process sales from the main web app
 * (desktop or tablet in a browser). It is NOT the dedicated POS hardware app. The standalone
 * terminal app for dedicated kiosks/iPads lives in `apps/pos/` — a separate Angular application
 * compiled and deployed independently.
 *
 * Placement under `features/sales/` is correct: this is a sales workflow, not a settings screen
 * or an administrative view. The folder name `pos/` refers to the kind of selling interface, not
 * to the dedicated `apps/pos/` app.
 */
@Component({
  selector: 'app-pos-page',
  standalone: true,
  imports: [CommonModule, A11yModule, ReactiveFormsModule, FormsModule, VxBranchPickerComponent, VxBranchLabelComponent, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y],
  templateUrl: './pos.page.html',
  styleUrls: ['./pos.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosPage {
  private fb = inject(FormBuilder);
  private readonly invoicesService = inject(InvoicesService);
  private readonly inventoryService = inject(InventoryService);
  private readonly posService = inject(PosService);
  private readonly notifications = inject(NotificationService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  /**
   * The till this screen operates. Single-terminal for now; multi-terminal is a matter of letting
   * the operator pick one and threading it through, not of the sale path, which is already keyed by
   * it end to end (shift lookup, sale record, stock movement).
   */
  private readonly terminalId = 'main';

  /** The open shift this screen is ringing sales into, if any. */
  readonly activeShiftId = signal<string | null>(null);
  /**
   * The branch the till's shift belongs to — every sale on it is that branch's. Chosen before the
   * shift opens (the cashier's default is proposed); fixed once it is open.
   */
  readonly shiftBranchId = signal<string | null>(null);
  readonly saving = signal(false);

  /**
   * Why the till cannot take a sale, when it cannot.
   *
   * Opening the shift used to fail into `error: () => void 0`. The drawer stayed closed, the
   * screen rendered a complete point of sale — cart, totals, a Charge button, a "Connected"
   * indicator — and the cashier had no way to know that nothing they rang up could be recorded.
   * A till that cannot account for a sale has to say so and stop, which is what this drives.
   */
  readonly shiftError = signal<string | null>(null);
  readonly shiftReady = computed(() => this.activeShiftId() !== null);

  /**
   * The market's own invoicing context: currency, and the rates it levies.
   *
   * The tax rate used to be `const POS_TAX_RATE = 0.18` — the Dominican ITBIS, applied to a
   * Mexican tenant's till at 16 %, to a United States one that has no national rate at all, and
   * printed on the ticket as the literal label "Impuestos (18%)". `InvoicesService.context()`
   * already answers this per tenant and is what the invoice form uses; the till now asks the same
   * question rather than assuming the answer.
   */
  private readonly context = toSignal(this.invoicesService.context(), { initialValue: null });

  /** The market's standard rate, as a fraction. Zero where the tenant has yet to configure one. */
  readonly standardRate = computed(() => this.context()?.taxRates?.[0] ?? 0);
  readonly currencyCode = computed(() => this.context()?.baseCurrency ?? null);
  /** True where the rate is sub-national (US, Brazil) and cannot be assumed from the country. */
  readonly taxNeedsConfiguration = computed(
    () => this.context()?.taxRequiresConfiguration === true,
  );

  protected readonly SearchIcon = Search;
  protected readonly XIcon = X;
  protected readonly PlusIcon = Plus;
  protected readonly MinusIcon = Minus;
  protected readonly TrashIcon = Trash2;
  protected readonly CreditCardIcon = CreditCard;
  // The empty-cart illustration referenced this by string name (`name="shopping-cart"`), which
  // only works when the icon set is registered globally — it is not, so the icon never rendered.
  protected readonly ShoppingCartIcon = ShoppingCart;
  protected readonly CashIcon = Banknote;
  protected readonly TransferIcon = Landmark;
  protected readonly MixedIcon = Shuffle;
  protected readonly PrintIcon = Printer;
  protected readonly DoneIcon = CheckCircle2;

  // ── Cobro (QA C-04) ──────────────────────────────────────────────────────────
  //
  // «Cobrar» registraba la venta al instante: sin forma de pago, sin efectivo recibido, sin cambio
  // y sin ticket. Toda venta se contaba como efectivo y la caja nunca cuadraba con el datáfono.
  // Ahora abre un cobro: se elige cómo paga el cliente, se teclea lo recibido, se ve el cambio y
  // al terminar se ofrece el ticket.

  /** The payment dialog is open. */
  readonly paying = signal(false);
  readonly payMethod = signal<'cash' | 'card' | 'transfer' | 'mixed'>('cash');
  /** Cash handed over (cash or the cash part of a mixed payment). */
  readonly cashTendered = signal<number | null>(null);
  /** The card part of a mixed payment. */
  readonly cardPart = signal<number | null>(null);
  readonly payReference = signal('');
  /** The sale just completed, for the ticket. */
  readonly lastSale = signal<CompletedSale | null>(null);

  /** Cash amounts a cashier is commonly handed for this total: exact, then round notes. */
  readonly cashSuggestions = computed(() => {
    const total = this.total();
    if (total <= 0) return [];
    const options = new Set<number>([total]);
    for (const step of [50, 100, 500, 1000]) options.add(Math.ceil(total / step) * step);
    return [...options].filter((value) => value >= total).sort((a, b) => a - b).slice(0, 5);
  });

  /** What has been tendered so far. */
  readonly paidSoFar = computed(() => {
    switch (this.payMethod()) {
      case 'cash':
        return round2(this.cashTendered() ?? 0);
      case 'mixed':
        return round2((this.cashTendered() ?? 0) + (this.cardPart() ?? 0));
      default:
        return this.total();
    }
  });
  readonly changeDue = computed(() => round2(Math.max(this.paidSoFar() - this.total(), 0)));
  readonly stillOwed = computed(() => round2(Math.max(this.total() - this.paidSoFar(), 0)));
  /** Only cash can produce change; a card part larger than the total is a keying mistake. */
  readonly payError = computed<string | null>(() => {
    if (this.payMethod() === 'mixed' && (this.cardPart() ?? 0) > this.total()) return 'sales.pos.pay.card_exceeds_total';
    if (this.stillOwed() > 0) return 'sales.pos.pay.not_enough';
    return null;
  });

  // Catálogo de productos simulado
  allProducts = signal<Product[]>([
    // { id: 'P001', name: 'Laptop Pro 15"', sku: 'LP-15-PRO', category: 'Electrónica', price: 1599.99, stock: 25, status: 'En Stock', imageUrl: 'https://i.imgur.com/4q0d7w9.png' },
    // { id: 'P002', name: 'Mouse Inalámbrico Ergonómico', sku: 'MS-ERG-WL', category: 'Accesorios', price: 49.50, stock: 8, status: 'Bajo Stock', imageUrl: 'https://i.imgur.com/h3G6Qv4.png' },
    // { id: 'P003', name: 'Teclado Mecánico RGB', sku: 'KB-MEC-RGB', category: 'Accesorios', price: 120.00, stock: 0, status: 'Agotado', imageUrl: 'https://i.imgur.com/a9a626d.png' },
    // { id: 'P004', name: 'Monitor UltraWide 34"', sku: 'MN-UW-34', category: 'Monitores', price: 799.00, stock: 15, status: 'En Stock', imageUrl: 'https://i.imgur.com/L30ER72.png' },
  ]);

  /**
   * Built in the field initializer, not in `ngOnInit`.
   *
   * `formChanges` below reads `saleForm.valueChanges` while the class fields are initialising,
   * which runs before any lifecycle hook — so with the form created in `ngOnInit` the component
   * threw "Cannot read properties of undefined (reading 'valueChanges')" the moment it was
   * constructed. The point of sale did not open at all.
   */
  saleForm: FormGroup = this.fb.group({
    cartItems: this.fb.array([]),
    // Empty means the walk-in customer, named in the reader's language and with the same name the
    // customer list uses («Consumidor final»), not the hard-coded «Cliente General» (QA M-17).
    customer: [''],
  });

  /** The name shown and sent for the sale's customer. */
  customerLabel(): string {
    return (this.saleForm.get('customer')?.value as string) || this.translate.instant('sales.pos.walk_in_customer');
  }

  /** A service is never «out of stock» (QA M-17); only goods run out. */
  isOutOfStock(product: Product): boolean {
    return product.kind !== 'SERVICE' && Number(product.stock ?? 0) <= 0;
  }

  /**
   * Reactive-forms controls are not signals, so a `computed()` that walks `cartItems.controls`
   * has nothing to depend on and never recomputes: the totals stayed at zero however many items
   * were added. Mirroring the form's value into a signal gives the computations a real
   * dependency.
   */
  private readonly formValue = toSignal(this.saleForm.valueChanges, {
    initialValue: this.saleForm.getRawValue(),
  });

  /**
   * Each line priced exactly as the server prices it (QA C-08).
   *
   * The till applied the market's standard rate to the whole ticket while the server taxed each
   * line at the PRODUCT's rate — which, for every product created before the form asked for one,
   * was 0 — so the two totals never agreed and every sale came back `409 pos.totals_changed`. The
   * rule is now the server's own (`effectiveProductTaxRate`): the product's rate when it is taxed
   * and has one, the standard rate when it is taxed and has none, zero otherwise; line amounts are
   * rounded to cents per line, as the server does, before they are summed.
   */
  private readonly pricedLines = computed(() => {
    const items = (this.formValue()?.cartItems ?? []) as Array<{
      quantity?: number;
      price?: number;
      taxTreatment?: string;
      taxRate?: number;
    }>;
    return items.map((item) => {
      const rate = effectiveRate(item.taxTreatment, item.taxRate, this.standardRate());
      const lineSubtotal = round2((item.quantity || 0) * (item.price || 0));
      return { rate, lineSubtotal, lineTax: round2(lineSubtotal * rate) };
    });
  });

  subtotal = computed(() => round2(this.pricedLines().reduce((acc, line) => acc + line.lineSubtotal, 0)));
  taxAmount = computed(() => round2(this.pricedLines().reduce((acc, line) => acc + line.lineTax, 0)));
  total = computed(() => round2(this.subtotal() + this.taxAmount()));

  /** The single rate on the ticket, or null when its lines carry different ones. */
  readonly taxRate = computed<number | null>(() => {
    const rates = [...new Set(this.pricedLines().map((line) => line.rate))];
    if (rates.length === 0) return this.standardRate();
    return rates.length === 1 ? rates[0] : null;
  });

  /** What the cashier types into the search box, matched against name and SKU. */
  readonly query = signal('');
  readonly visibleProducts = computed(() => {
    const term = this.query().trim().toLocaleLowerCase();
    const products = this.allProducts();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLocaleLowerCase().includes(term) ||
        (product.sku ?? '').toLocaleLowerCase().includes(term),
    );
  });

  /** Products whose picture failed to load: they show their initials instead of a broken image. */
  readonly brokenImages = signal<ReadonlySet<string>>(new Set());

  markImageBroken(productId: string): void {
    this.brokenImages.update((current) => new Set([...current, productId]));
  }

  initialsOf(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase() ?? '')
      .join('');
  }

  get cartItems(): FormArray {
    return this.saleForm.get('cartItems') as FormArray;
  }

  addToCart(product: Product): void {
    const existingItem = this.cartItems.controls.find(
      (control) => control.get('productId')?.value === product.id
    );
    const inCart = Number(existingItem?.get('quantity')?.value ?? 0);
    //  A good cannot be sold beyond what is on hand: the server refuses the whole sale when one
    //  line is short. Said at the counter, on the item, before the cashier charges the customer.
    if (product.kind !== 'SERVICE' && inCart + 1 > Number(product.stock ?? 0)) {
      this.notifications.showError('sales.pos.not_enough_stock', { name: product.name, available: product.stock ?? 0 });
      return;
    }
    if (existingItem) {
      existingItem.get('quantity')?.setValue(inCart + 1);
    } else {
      const newItem = this.fb.group({
        productId: [product.id],
        name: [product.name],
        price: [product.price],
        quantity: [1],
        taxTreatment: [product.taxTreatment ?? 'TAXED'],
        taxRate: [Number(product.taxRate ?? 0)],
      });
      this.cartItems.push(newItem);
    }
  }

  updateQuantity(index: number, change: number): void {
    const item = this.cartItems.at(index);
    const newQuantity = (item.get('quantity')?.value || 0) + change;
    if (newQuantity > 0) {
      item.get('quantity')?.setValue(newQuantity);
    } else {
      this.cartItems.removeAt(index);
    }
  }

  removeItem(index: number): void {
    this.cartItems.removeAt(index);
  }

  getItemTotal(item: any): number {
    return (item.get('quantity')?.value || 0) * (item.get('price')?.value || 0);
  }

  constructor() {
    this.loadProducts();
    this.ensureShift();
  }

  /** Reload the catalogue and re-price what is already in the cart from it. */
  private refreshCartFromCatalogue(): void {
    this.inventoryService.getProducts().subscribe({
      next: (products) => {
        const active = products.filter((p) => p.status === 'Active');
        this.allProducts.set(active);
        const byId = new Map(active.map((p) => [p.id, p]));
        for (let index = this.cartItems.length - 1; index >= 0; index -= 1) {
          const control = this.cartItems.at(index);
          const product = byId.get(control.get('productId')?.value);
          if (!product) {
            this.cartItems.removeAt(index);
            continue;
          }
          control.patchValue({
            price: product.price,
            taxTreatment: product.taxTreatment ?? 'TAXED',
            taxRate: Number(product.taxRate ?? 0),
          });
        }
      },
      error: () => this.notifications.showError('pos.load_products_error'),
    });
  }

  /** Fill the till catalogue from the tenant's own inventory — only sellable, in-stock items. */
  private loadProducts(): void {
    this.inventoryService.getProducts().subscribe({
      next: (products) =>
        this.allProducts.set(products.filter((p) => p.status === 'Active')),
      error: () => this.notifications.showError('pos.load_products_error'),
    });
  }

  /**
   * A sale needs an open shift. Rather than make the operator open one by hand before the first
   * sale, adopt the terminal's active shift if there is one and open a zero-float shift otherwise —
   * the backend rejects a second open shift per terminal, so this is idempotent under a refresh.
   */
  private ensureShift(): void {
    this.shiftError.set(null);
    this.posService.getActiveShift(this.terminalId).subscribe({
      next: (shift) => {
        if (shift) {
          this.activeShiftId.set(shift.id);
          this.shiftBranchId.set(shift.branchId ?? null);
          return;
        }
        this.posService.openShift(this.terminalId, 0, this.shiftBranchId()).subscribe({
          next: (opened) => {
            this.activeShiftId.set(opened.id);
            this.shiftBranchId.set(opened.branchId ?? null);
            this.shiftError.set(null);
          },
          error: (err: HttpErrorResponse) => this.failShift(err),
        });
      },
      error: (err: HttpErrorResponse) => this.failShift(err),
    });
  }

  /**
   * The till has no shift, so it takes no sales until someone fixes the cause.
   *
   * The message is ours, resolved from the code the API sent; the server's own sentence never
   * reaches the counter, for the same reason it does not on a failed sale.
   */
  private failShift(err: HttpErrorResponse): void {
    this.activeShiftId.set(null);
    const key = this.errors.keyFor(err);
    this.shiftError.set(key === 'errors.unexpected' ? 'pos.shift_error' : key);
    this.notifications.showError(this.shiftError()!);
  }

  /** Lets the operator retry without reloading the page, once the cause is addressed. */
  retryShift(): void {
    this.ensureShift();
  }

  /** «Cobrar»: opens the payment dialog instead of booking the sale on the spot (QA C-04). */
  openPayment(): void {
    if (this.saving() || this.cartItems.length === 0) return;
    if (!this.shiftReady()) {
      this.notifications.showError(this.shiftError() ?? 'pos.shift_error');
      return;
    }
    this.payMethod.set('cash');
    this.cashTendered.set(this.total());
    this.cardPart.set(null);
    this.payReference.set('');
    this.paying.set(true);
  }

  choosePayMethod(method: 'cash' | 'card' | 'transfer' | 'mixed'): void {
    this.payMethod.set(method);
    if (method === 'cash') this.cashTendered.set(this.total());
    if (method === 'mixed') {
      this.cardPart.set(null);
      this.cashTendered.set(null);
    }
  }

  cancelPayment(): void {
    this.paying.set(false);
  }

  /** The tenders as the server expects them. */
  private tenders(): PosPaymentPayload[] {
    const reference = this.payReference().trim() || undefined;
    switch (this.payMethod()) {
      case 'cash':
        return [{ method: 'cash', amount: round2(this.cashTendered() ?? 0) }];
      case 'card':
        return [{ method: 'card', amount: this.total(), reference }];
      case 'transfer':
        return [{ method: 'transfer', amount: this.total(), reference }];
      case 'mixed': {
        const parts: PosPaymentPayload[] = [];
        if ((this.cardPart() ?? 0) > 0) parts.push({ method: 'card', amount: round2(this.cardPart() ?? 0), reference });
        if ((this.cashTendered() ?? 0) > 0) parts.push({ method: 'cash', amount: round2(this.cashTendered() ?? 0) });
        return parts;
      }
    }
  }

  /** Closes the ticket and leaves the till ready for the next customer. */
  newSale(): void {
    this.lastSale.set(null);
  }

  /** Prints the ticket of the sale just completed, in its own window so nothing else prints. */
  printTicket(): void {
    const sale = this.lastSale();
    if (!sale) return;
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    const money = (value: number) => this.format.money(value, sale.currency ?? undefined);
    const rows = sale.lines
      .map((line) => `<tr><td>${escapeHtml(line.name)}<br><small>${line.quantity} × ${money(line.price)}</small></td><td class="r">${money(line.quantity * line.price)}</td></tr>`)
      .join('');
    const tenders = sale.payments
      .map((payment) => `<tr><td>${escapeHtml(t('sales.pos.pay.method.' + payment.method))}</td><td class="r">${money(payment.amount)}</td></tr>`)
      .join('');
    const html = `<!doctype html><html lang="${escapeHtml(this.translate.getCurrentLang() || 'es')}"><head><meta charset="utf-8"><title>${escapeHtml(t('sales.pos.ticket.title'))}</title>
<style>body{font:13px/1.4 system-ui,sans-serif;width:72mm;margin:0 auto;padding:8px}h1{font-size:15px;margin:0 0 4px;text-align:center}p{margin:0 0 6px;text-align:center}table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}.r{text-align:right}.t td{border-top:1px dashed #000;font-weight:700}small{color:#444}</style></head>
<body><h1>${escapeHtml(t('sales.pos.ticket.title'))}</h1><p>${escapeHtml(this.format.date(sale.createdAt, 'dateTime'))}</p><p>${escapeHtml(t('sales.pos.customer'))} ${escapeHtml(sale.customer)}</p>
<table>${rows}<tr class="t"><td>${escapeHtml(t('sales.pos.amount_due'))}</td><td class="r">${money(sale.total)}</td></tr>${tenders}
${sale.changeDue > 0 ? `<tr><td>${escapeHtml(t('sales.pos.pay.change'))}</td><td class="r">${money(sale.changeDue)}</td></tr>` : ''}</table>
<p style="margin-top:10px">${escapeHtml(t('sales.pos.ticket.thanks'))}</p></body></html>`;
    const win = window.open('', '_blank', 'width=420,height=640');
    if (!win) {
      this.notifications.showWarning('sales.pos.ticket.popup_blocked');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  completeSale(): void {
    if (this.saving() || this.saleForm.invalid || this.cartItems.length === 0) return;
    if (this.payError()) return;
    // No shift, no sale: the server would refuse it, and a sale with nowhere to be counted and
    // no one accountable for the drawer is exactly what the shift exists to prevent.
    if (!this.shiftReady()) {
      this.notifications.showError(this.shiftError() ?? 'pos.shift_error');
      return;
    }

    const items = (this.cartItems.getRawValue() as Array<{
      productId: string;
      name: string;
      price: number;
      quantity: number;
    }>).map((i) => ({
      productId: i.productId,
      productName: i.name,
      price: i.price,
      quantity: i.quantity,
    }));

    this.saving.set(true);
    this.posService
      .processSale({
        terminalId: this.terminalId,
        items,
        subtotal: this.subtotal(),
        tax: this.taxAmount(),
        total: this.total(),
        customerName: this.customerLabel(),
        payments: this.tenders(),
      })
      .subscribe({
        next: (sale: PosSale) => {
          this.saving.set(false);
          this.paying.set(false);
          this.lastSale.set({
            createdAt: sale.createdAt ?? new Date().toISOString(),
            customer: this.customerLabel(),
            currency: this.currencyCode(),
            total: Number(sale.total ?? this.total()),
            changeDue: Number(sale.changeDue ?? this.changeDue()),
            payments: sale.payments?.length ? sale.payments : this.tenders(),
            lines: items.map((item) => ({ name: item.productName, quantity: item.quantity, price: item.price })),
          });
          this.cartItems.clear();
          this.notifications.showSuccess('pos.sale_completed');
          // Reflect the stock the sale consumed.
          this.loadProducts();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          // Never the server's own sentence. It used to be forwarded when present, which put an
          // operator's message — sometimes in the other language — in front of whoever is at the
          // counter. `keyFor` resolves the code the API sent, and falls back to our own wording.
          const messageKey = (err.error as { messageKey?: string } | null)?.messageKey;
          if (messageKey === 'pos.totals_changed' || messageKey === 'pos.prices_changed') {
            // The catalogue moved under the till. Refresh it and say so: the cashier shows the
            // customer the new amount and charges again, rather than staring at a silent button.
            this.refreshCartFromCatalogue();
            this.notifications.showWarning('sales.pos.prices_updated_review');
            return;
          }
          const key = this.errors.keyFor(err);
          this.notifications.showError(
            key === 'errors.unexpected' || /^errors\.http_/.test(key) ? 'pos.sale_error' : key,
          );
        },
      });
  }
}

/** What the ticket prints for a completed sale. */
interface CompletedSale {
  createdAt: string;
  customer: string;
  currency: string | null;
  total: number;
  changeDue: number;
  payments: PosPaymentPayload[];
  lines: Array<{ name: string; quantity: number; price: number }>;
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** The server's rule (`effectiveProductTaxRate`), mirrored so the till shows what will be charged. */
function effectiveRate(treatment: string | undefined, own: number | undefined, standard: number): number {
  if ((treatment ?? 'TAXED') !== 'TAXED') return 0;
  const rate = Number(own);
  return Number.isFinite(rate) && rate > 0 ? rate : standard;
}
