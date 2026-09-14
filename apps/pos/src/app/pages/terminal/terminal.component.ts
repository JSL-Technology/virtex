import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FormatService, resolveErrorKey } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../core/auth.service';
import { PosApiService, Product } from '../../core/pos-api.service';

interface CartLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
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
            <button class="ghost" (click)="closeShift()">{{ 'pos.close_shift' | translate }}</button>
          } @else {
            <span class="dot closed"></span> {{ 'pos.no_shift_open' | translate }}
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
                <div class="line-total">{{ format(line.price * line.quantity) }}</div>
                <button class="rm" [attr.aria-label]="'pos.remove_line' | translate" (click)="removeLine(i)">×</button>
              </div>
            } @empty {
              <p class="muted">{{ 'pos.empty_order' | translate }}</p>
            }
          </div>

          <div class="totals">
            <div><span>{{ 'pos.subtotal' | translate }}</span><span>{{ format(subtotal()) }}</span></div>
            <div>
              <span>{{ 'pos.tax_with_rate' | translate: { rate: taxPercent() } }}</span>
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
  readonly shiftTotal = signal(0);
  readonly salesCount = signal(0);

  private readonly currency = signal<string | null>(null);
  readonly taxRate = signal(0);

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.products();
    if (!q) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q),
    );
  });

  readonly subtotal = computed(() =>
    this.cart().reduce((acc, l) => acc + l.price * l.quantity, 0),
  );
  readonly tax = computed(() => this.subtotal() * this.taxRate());
  readonly total = computed(() => this.subtotal() + this.tax());
  readonly taxPercent = computed(() => this.formatter.number(this.taxRate() * 100, '1.0-2'));

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
        this.taxRate.set(ctx?.taxRates?.[0] ?? 0);
      },
      error: () => void 0,
    });
  }

  private ensureShift(): void {
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
    this.api.openShift(this.terminalId, 0).subscribe({
      next: (shift) => this.adoptShift(shift),
      error: (err) => this.flash(this.errorKey(err, 'pos.open_shift_error'), true),
    });
  }

  closeShift(): void {
    const id = this.shiftId();
    if (!id) return;
    this.api.closeShift(id, this.shiftTotal()).subscribe({
      next: () => {
        this.shiftId.set(null);
        this.shiftTotal.set(0);
        this.salesCount.set(0);
        this.flash('pos.shift_closed');
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
        { productId: product.id, name: product.name, price: product.price, quantity: 1 },
      ];
    });
  }

  changeQty(index: number, delta: number): void {
    this.cart.update((lines) =>
      lines
        .map((l, i) => (i === index ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  removeLine(index: number): void {
    this.cart.update((lines) => lines.filter((_, i) => i !== index));
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
        subtotal: round2(this.subtotal()),
        tax: round2(this.tax()),
        total: round2(this.total()),
      })
      .subscribe({
        next: () => {
          this.charging.set(false);
          this.salesCount.update((n) => n + 1);
          this.shiftTotal.update((t) => t + round2(this.total()));
          this.cart.set([]);
          this.flash('pos.sale_completed');
          this.loadProducts();
        },
        error: (err) => {
          this.charging.set(false);
          this.flash(this.errorKey(err, 'pos.sale_error'), true);
        },
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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
