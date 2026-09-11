import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
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
 */
@Component({
  selector: 'pos-terminal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pos">
      <header class="topbar">
        <div class="brand">Virtex POS</div>
        <div class="shift">
          @if (shiftId()) {
            <span class="dot open"></span> Shift open · {{ salesCount() }} sales ·
            {{ format(shiftTotal()) }}
            <button class="ghost" (click)="closeShift()">Close shift</button>
          } @else {
            <span class="dot closed"></span> No open shift
            <button class="ghost" (click)="openShift()">Open shift</button>
          }
        </div>
        <div class="user">
          {{ auth.user()?.email }}
          <button class="ghost" (click)="logout()">Sign out</button>
        </div>
      </header>

      <main class="body">
        <section class="catalog">
          <input
            class="search"
            type="search"
            placeholder="Search products by name or SKU…"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
          @if (loading()) {
            <p class="muted">Loading catalogue…</p>
          } @else {
            <div class="grid">
              @for (p of filtered(); track p.id) {
                <button class="tile" [disabled]="p.stock <= 0" (click)="add(p)">
                  <div class="tile-name">{{ p.name }}</div>
                  <div class="tile-meta">{{ p.sku }}</div>
                  <div class="tile-foot">
                    <span class="price">{{ format(p.price) }}</span>
                    <span class="stock" [class.low]="p.stock <= 5">{{ p.stock }} in stock</span>
                  </div>
                </button>
              } @empty {
                <p class="muted">No products. Add products in inventory first.</p>
              }
            </div>
          }
        </section>

        <aside class="ticket">
          <h2>Current order</h2>
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
                <button class="rm" (click)="removeLine(i)">×</button>
              </div>
            } @empty {
              <p class="muted">Add products to start a sale.</p>
            }
          </div>

          <div class="totals">
            <div><span>Subtotal</span><span>{{ format(subtotal()) }}</span></div>
            <div><span>Tax ({{ (taxRate() * 100).toFixed(0) }}%)</span><span>{{ format(tax()) }}</span></div>
            <div class="grand"><span>Total</span><span>{{ format(total()) }}</span></div>
          </div>

          @if (message()) {
            <div class="msg" [class.err]="messageIsError()">{{ message() }}</div>
          }

          <button class="charge" [disabled]="cart().length === 0 || charging()" (click)="charge()">
            {{ charging() ? 'Processing…' : 'Charge ' + format(total()) }}
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
  readonly auth = inject(AuthService);

  private readonly terminalId = 'main';

  readonly products = signal<Product[]>([]);
  readonly cart = signal<CartLine[]>([]);
  readonly query = signal('');
  readonly loading = signal(true);
  readonly charging = signal(false);
  readonly message = signal<string | null>(null);
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

  constructor() {
    this.loadProducts();
    this.loadContext();
    this.ensureShift();
  }

  format(value: number): string {
    const code = this.currency();
    try {
      return new Intl.NumberFormat(undefined, {
        style: code ? 'currency' : 'decimal',
        currency: code ?? undefined,
        minimumFractionDigits: 2,
      }).format(value ?? 0);
    } catch {
      return (value ?? 0).toFixed(2);
    }
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
        this.flash('Could not load the catalogue', true);
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
      error: (err) => this.flash(err?.error?.message ?? 'Could not open shift', true),
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
        this.flash('Shift closed');
      },
      error: (err) => this.flash(err?.error?.message ?? 'Could not close shift', true),
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
    this.message.set(null);
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
          this.flash('Sale completed');
          this.loadProducts();
        },
        error: (err) => {
          this.charging.set(false);
          this.flash(err?.error?.message ?? 'The sale could not be completed', true);
        },
      });
  }

  logout(): void {
    this.auth.logout().subscribe(() => this.router.navigateByUrl('/login'));
  }

  private flash(text: string, isError = false): void {
    this.message.set(text);
    this.messageIsError.set(isError);
    setTimeout(() => this.message.set(null), 4000);
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
