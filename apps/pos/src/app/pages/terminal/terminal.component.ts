import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FormatService, resolveErrorKey } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../core/auth.service';
import { MyBranches, PosApiService, Product } from '../../core/pos-api.service';

interface CartLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  /** The rate this line is taxed at: the product's own, or zero when it is not a taxed item. */
  taxRate: number;
}

/**
 * The till prices a line exactly as the server does — per line, rounded to the cent — so that the
 * amount shown to the customer is the amount the server will accept. The server remains the
 * authority: it re-prices from the catalogue and refuses a sale whose customer saw something else.
 */
function lineSubtotal(line: CartLine): number {
  return round2(line.price * line.quantity);
}

function lineTax(line: CartLine): number {
  return round2(lineSubtotal(line) * line.taxRate);
}

/**
 * The server's rule (`effectiveProductTaxRate`): a taxed product at its own rate, or at the
 * tenant's standard rate when it carries none; anything else untaxed. The two used to disagree on
 * products created without a rate, and every such sale was refused as "totals changed" (QA C-08).
 */
function taxRateOf(product: Product, standardRate: number): number {
  if (product.taxTreatment !== 'TAXED' && product.taxTreatment !== undefined) return 0;
  const own = Number(product.taxRate ?? 0);
  return own > 0 ? own : standardRate;
}

/**
 * The till. A single full-screen surface: catalogue on the left, ticket on the right, charge at the
 * bottom — the whole sell/charge loop without navigating away. This is the POS *application*; the
 * backend `pos` module is only its API.
 *
 * ## Every string here used to be English, written into the template
 *
 * In a product whose default language is Spanish and whose pilot market is the Dominican Republic,
 * on the one screen operated by a cashier rather than by an accountant. The backend's POS module was
 * always properly localised — `pos.service.ts` has thrown `NotFoundError('pos.shift_not_found')`
 * since it was written — and this component threw that away, showing `err.error.message` raw or one
 * of its own English literals.
 *
 * Money went through `Intl.NumberFormat(undefined, …)`, which is the BROWSER's locale: a terminal
 * running Windows in English printed Dominican pesos with US grouping. `FormatService` takes the
 * locale the server resolved for the tenant, and the currency of the amount rather than a guess.
 */
@Component({
  selector: 'pos-terminal',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pos">
      <header class="topbar">
        <div class="brand">{{ 'apps.pos' | translate }}</div>
        <div class="shift">
          @if (shiftId()) {
            <span class="dot open"></span>
            {{ 'pos.shift_open_summary' | translate: { count: salesCount(), amount: format(shiftTotal()) } }}
            @if (closing()) {
              <label class="count">
                {{ 'pos.counted_cash' | translate }}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputmode="decimal"
                  [value]="countedCash()"
                  (input)="countedCash.set($any($event.target).value)"
                />
              </label>
              <button class="ghost" [disabled]="!validCount()" (click)="closeShift()">{{ 'pos.confirm_close_shift' | translate }}</button>
              <button class="ghost" (click)="closing.set(false)">{{ 'pos.cancel' | translate }}</button>
            } @else {
              <button class="ghost" (click)="startClosing()">{{ 'pos.close_shift' | translate }}</button>
            }
          } @else {
            <span class="dot closed"></span> {{ 'pos.no_shift_open' | translate }}
            <!-- Where the till stands, when the company has branches and there is a choice. -->
            @if (branches().length > 1) {
              <label class="branch">
                <span>{{ 'pos.branch' | translate }}</span>
                <select [value]="branchId() ?? ''" (change)="branchId.set($any($event.target).value || null)">
                  @if (!branchId()) {
                    <option value="" disabled>{{ 'pos.choose_branch' | translate }}</option>
                  }
                  @for (branch of branches(); track branch.id) {
                    <option [value]="branch.id" [selected]="branch.id === branchId()">{{ branch.code }} · {{ branch.name }}</option>
                  }
                </select>
              </label>
            }
            <button class="ghost" (click)="openShift()">{{ 'pos.open_shift' | translate }}</button>
          }
        </div>
        <div class="user">
          {{ auth.user()?.email }}
          <button class="ghost" (click)="logout()">{{ 'pos.sign_out' | translate }}</button>
        </div>
      </header>

      <main class="body">
        <section class="catalog">
          <input
            class="search"
            type="search"
            [placeholder]="'pos.search_products' | translate"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
          @if (loading()) {
            <p class="muted">{{ 'pos.loading_catalogue' | translate }}</p>
          } @else {
            <div class="grid">
              @for (p of filtered(); track p.id) {
                <button class="tile" [disabled]="p.stock <= 0" (click)="add(p)">
                  <div class="tile-name">{{ p.name }}</div>
                  <div class="tile-meta">{{ p.sku }}</div>
                  <div class="tile-foot">
                    <span class="price">{{ format(p.price) }}</span>
                    <span class="stock" [class.low]="p.stock <= 5">{{ 'pos.in_stock' | translate: { count: p.stock } }}</span>
                  </div>
                </button>
              } @empty {
                <p class="muted">{{ 'pos.no_products' | translate }}</p>
              }
            </div>
          }
        </section>

        <aside class="ticket">
          <h2>{{ 'pos.current_order' | translate }}</h2>
          <div class="lines">
            @for (line of cart(); track line.productId; let i = $index) {
              <div class="line">
                <div class="line-name">{{ line.name }}</div>
                <div class="qty">
                  <button (click)="changeQty(i, -1)">−</button>
                  <span>{{ line.quantity }}</span>
                  <button (click)="changeQty(i, 1)">+</button>
                </div>
                <div class="line-total">{{ format(lineTotal(line)) }}</div>
                <button class="rm" [attr.aria-label]="'pos.remove_line' | translate" (click)="removeLine(i)">×</button>
              </div>
            } @empty {
              <p class="muted">{{ 'pos.empty_order' | translate }}</p>
            }
          </div>

          <div class="totals">
            <div><span>{{ 'pos.subtotal' | translate }}</span><span>{{ format(subtotal()) }}</span></div>
            <div>
              <span>{{ 'pos.taxes' | translate }}</span>
              <span>{{ format(tax()) }}</span>
            </div>
            <div class="grand"><span>{{ 'pos.total' | translate }}</span><span>{{ format(total()) }}</span></div>
          </div>

          @if (messageKey()) {
            <div class="msg" [class.err]="messageIsError()">{{ messageKey()! | translate }}</div>
          }

          <button class="charge" [disabled]="cart().length === 0 || charging()" (click)="charge()">
            {{
              charging()
                ? ('pos.charging' | translate)
                : ('pos.charge' | translate: { amount: format(total()) })
            }}
          </button>
        </aside>
      </main>
    </div>
  `,
  styleUrl: './terminal.component.scss',
})
export class TerminalComponent {
  private readonly api = inject(PosApiService);
  private readonly router = inject(Router);
  private readonly formatter = inject(FormatService);
  private readonly translate = inject(TranslateService);
  readonly auth = inject(AuthService);

  private readonly terminalId = 'main';

  readonly products = signal<Product[]>([]);
  readonly cart = signal<CartLine[]>([]);
  readonly query = signal('');
  readonly loading = signal(true);
  readonly charging = signal(false);
  /** A catalogue key rather than a sentence, so the toast follows a language switch. */
  readonly messageKey = signal<string | null>(null);
  readonly messageIsError = signal(false);

  readonly shiftId = signal<string | null>(null);
  /** The cashier's branches, and the one a new shift opens in (their default proposed). */
  readonly branches = signal<MyBranches['branches']>([]);
  readonly branchId = signal<string | null>(null);
  readonly shiftTotal = signal(0);
  readonly salesCount = signal(0);

  /** The tenant's standard consumption-tax rate, for taxed products without their own. */

  private readonly standardRate = signal(0);

  private readonly currency = signal<string | null>(null);

  /** The cash-up form: shown while closing, holding the cash the cashier counted. */
  readonly closing = signal(false);
  readonly countedCash = signal<string>('');
  readonly validCount = computed(() => {
    const value = Number(this.countedCash());
    return this.countedCash().trim() !== '' && Number.isFinite(value) && value >= 0;
  });

  /**
   * The key the NEXT charge is sent with. It survives a failed attempt, so retrying the same
   * cart cannot ring it twice, and is replaced once the sale succeeds or the cart changes.
   */
  private saleKey: string = PosIdempotency.newKey();

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.products();
    if (!q) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q),
    );
  });

  readonly subtotal = computed(() => round2(this.cart().reduce((acc, l) => acc + lineSubtotal(l), 0)));
  readonly tax = computed(() => round2(this.cart().reduce((acc, l) => acc + lineTax(l), 0)));
  readonly total = computed(() => round2(this.subtotal() + this.tax()));

  lineTotal(line: CartLine): number {
    return lineSubtotal(line);
  }

  constructor() {
    this.loadProducts();
    this.loadContext();
    this.ensureShift();
  }

  /**
   * An amount, in the tenant's locale and the tenant's currency.
   *
   * This used to call `Intl.NumberFormat(undefined, …)`, and `undefined` means the BROWSER's locale.
   * A till is a fixed machine on a counter whose regional settings nobody has ever looked at, so the
   * figure on the customer-facing total was punctuated according to the operating system's install
   * language rather than the country the shop is in. `FormatService` reads the locale the server
   * resolved for this tenant.
   */
  format(value: number): string {
    return this.formatter.money(value ?? 0, this.currency());
  }

  private loadProducts(): void {
    this.loading.set(true);
    this.api.getProducts().subscribe({
      next: (list) => {
        this.products.set(list.filter((p) => p.status === 'Active'));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.flash('pos.load_products_error', true);
      },
    });
  }

  private loadContext(): void {
    this.api.invoicingContext().subscribe({
      next: (ctx) => {
        this.currency.set(ctx?.baseCurrency ?? null);
        this.standardRate.set(ctx?.taxRates?.[0] ?? 0);
      },
      error: () => void 0,
    });
  }

  private ensureShift(): void {
    this.api.myBranches().subscribe({
      next: (mine) => {
        this.branches.set(mine.branches);
        const proposed =
          mine.defaultBranchId ??
          (mine.branches.length === 1 ? mine.branches[0].id : null) ??
          mine.branches.find((b) => b.isHeadquarters)?.id ??
          null;
        if (!this.branchId()) this.branchId.set(proposed);
      },
      // No branch list: the shift opens where the server decides, as before branches existed.
      error: () => this.branches.set([]),
    });
    this.api.getActiveShift(this.terminalId).subscribe({
      next: (shift) => {
        if (shift) this.adoptShift(shift);
        else this.openShift();
      },
      error: () => void 0,
    });
  }

  private adoptShift(shift: { id: string; salesTotal: number; salesCount: number }): void {
    this.shiftId.set(shift.id);
    this.shiftTotal.set(Number(shift.salesTotal) || 0);
    this.salesCount.set(shift.salesCount || 0);
  }

  openShift(): void {
    this.api.openShift(this.terminalId, 0, this.branchId()).subscribe({
      next: (shift) => this.adoptShift(shift),
      error: (err) => this.flash(this.errorKey(err, 'pos.open_shift_error'), true),
    });
  }

  startClosing(): void {
    this.countedCash.set('');
    this.closing.set(true);
  }

  /**
   * Close with the cash the cashier COUNTED. This used to send the shift's sales total as the
   * closing balance, so the cash-up compared the takings with themselves and always balanced.
   */
  closeShift(): void {
    const id = this.shiftId();
    if (!id || !this.validCount()) return;
    this.api.closeShift(id, round2(Number(this.countedCash()))).subscribe({
      next: (closed) => {
        this.shiftId.set(null);
        this.shiftTotal.set(0);
        this.salesCount.set(0);
        this.closing.set(false);
        const variance = Number(closed?.closingVariance ?? 0);
        this.flash(variance === 0 ? 'pos.shift_closed' : 'pos.shift_closed_with_variance', variance !== 0);
      },
      error: (err) => this.flash(this.errorKey(err, 'pos.close_shift_error'), true),
    });
  }

  add(product: Product): void {
    this.cart.update((lines) => {
      const existing = lines.find((l) => l.productId === product.id);
      if (existing) {
        return lines.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...lines,
        {
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          quantity: 1,
          taxRate: taxRateOf(product, this.standardRate()),
        },
      ];
    });
    this.saleKey = PosIdempotency.newKey();
  }

  changeQty(index: number, delta: number): void {
    this.cart.update((lines) =>
      lines
        .map((l, i) => (i === index ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
    this.saleKey = PosIdempotency.newKey();
  }

  removeLine(index: number): void {
    this.cart.update((lines) => lines.filter((_, i) => i !== index));
    this.saleKey = PosIdempotency.newKey();
  }

  charge(): void {
    if (this.cart().length === 0 || this.charging()) return;
    this.charging.set(true);
    this.messageKey.set(null);
    this.api
      .processSale({
        terminalId: this.terminalId,
        items: this.cart().map((l) => ({
          productId: l.productId,
          productName: l.name,
          price: l.price,
          quantity: l.quantity,
        })),
        subtotal: this.subtotal(),
        tax: this.tax(),
        total: this.total(),
      }, this.saleKey)
      .subscribe({
        next: (sale) => {
          this.charging.set(false);
          this.salesCount.update((n) => n + 1);
          this.shiftTotal.update((t) => round2(t + Number(sale?.total ?? this.total())));
          this.cart.set([]);
          this.saleKey = PosIdempotency.newKey();
          this.flash('pos.sale_completed');
          this.loadProducts();
        },
        error: (err) => {
          this.charging.set(false);
          const key = this.errorKey(err, 'pos.sale_error');
          // The server priced the cart differently from this till's copy of the catalogue: reload
          // it and re-price the open cart, so the next attempt shows — and charges — the real amount.
          if (key === 'pos.prices_changed' || key === 'pos.totals_changed') {
            this.repriceCart();
          }
          this.flash(key, true);
        },
      });
  }

  /** Reload the catalogue and bring every open line to its current price and rate. */
  private repriceCart(): void {
    this.api.getProducts().subscribe({
      next: (list) => {
        const active = list.filter((p) => p.status === 'Active');
        this.products.set(active);
        const byId = new Map(active.map((p) => [p.id, p]));
        this.cart.update((lines) =>
          lines
            .filter((line) => byId.has(line.productId))
            .map((line) => {
              const product = byId.get(line.productId)!;
              return { ...line, name: product.name, price: Number(product.price), taxRate: taxRateOf(product, this.standardRate()) };
            }),
        );
        this.saleKey = PosIdempotency.newKey();
      },
      error: () => this.flash('pos.load_products_error', true),
    });
  }

  logout(): void {
    this.auth.logout().subscribe(() => this.router.navigateByUrl('/login'));
  }

  /**
   * The key a failure is shown with, or the caller's own when the server said nothing specific.
   *
   * The till used to render `err.error.message` — the server's own sentence, forwarded raw. That is
   * how a cashier could be shown a database error, and it was English or Spanish depending on which
   * layer produced it. `resolveErrorKey` applies the same order the web client uses.
   */
  private errorKey(err: unknown, fallback: string): string {
    const key = resolveErrorKey(err as { status?: number; error?: unknown }, (candidate) =>
      this.translate.instant(candidate) !== candidate,
    );
    return key === 'errors.unexpected' ? fallback : key;
  }

  private flash(key: string, isError = false): void {
    this.messageKey.set(key);
    this.messageIsError.set(isError);
    setTimeout(() => this.messageKey.set(null), 4000);
  }
}

/** Idempotency keys for sales: random, and unique per cart. */
const PosIdempotency = {
  newKey(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  },
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
