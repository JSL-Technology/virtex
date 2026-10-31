import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { resolveErrorKey } from '@virteex/shared/ui-i18n';
import {
  Observable,
  catchError,
  finalize,
  forkJoin,
  map,
  of,
  tap,
  throwError,
} from 'rxjs';
import { AuthService } from '../core/auth.service';
import {
  CatalogueItem,
  MyBranches,
  PosApiService,
  PosContext,
  PosSale,
  PosShift,
  ProcessSalePayload,
  ShiftReport,
} from '../core/pos-api.service';
import { TerminalConfigService } from '../core/terminal-config.service';
import { ConnectivityService } from '../core/connectivity.service';
import {
  OutboxService,
  isNetworkFailure,
  provisionalSale,
} from '../core/outbox.service';
import { ToastService } from '../core/toast.service';
import {
  CartLine,
  addToCart,
  cartTotals,
  findByCode,
  isOutOfStock,
  repriceCart,
  setQuantity,
} from '../domain/cart';
import { newIdempotencyKey } from '../domain/idempotency';
import { TenderDraft, tenders } from '../domain/payment';

/** A ticket set aside while the customer fetches something, to be recalled later. */
export interface ParkedTicket {
  id: string;
  lines: CartLine[];
  customer: string;
  parkedAt: string;
}

const PARKED_KEY = 'virtex.pos.parked';
/** More than this many tickets on hold is a forgotten queue, not a busy counter. */
const MAX_PARKED = 20;

/**
 * The till's state: what it sells, the shift it sells into, and the ticket being rung up.
 *
 * One store rather than one component holding everything, because four surfaces read and change
 * the same ticket — the catalogue adds to it, the ticket edits it, the payment dialog charges it,
 * the journal reprints and voids what it became — and each of them used to keep its own copy.
 */
@Injectable({ providedIn: 'root' })
export class TillStore {
  private readonly api = inject(PosApiService);
  private readonly auth = inject(AuthService);
  private readonly config = inject(TerminalConfigService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly connectivity = inject(ConnectivityService);
  readonly outbox = inject(OutboxService);

  readonly terminalId = this.config.terminalId;

  constructor() {
    // A sale the outbox delivered moved stock and the shift's totals on the server.
    this.outbox.onSynced = () => {
      this.loadCatalogue();
      this.loadShift();
    };
  }

  // ── Company context ──────────────────────────────────────────────────────────
  readonly context = signal<PosContext | null>(null);
  readonly currency = computed(() => this.context()?.currency ?? null);
  readonly standardRate = computed(() => this.context()?.standardTaxRate ?? 0);
  readonly taxNeedsConfiguration = computed(
    () => this.context()?.taxRequiresConfiguration === true,
  );
  /** Each sale is a fiscal document: the till asks for the RNC and prints the e-NCF and QR. */
  readonly fiscal = computed(() => this.context()?.issuesFiscalDocuments === true);

  // ── Catalogue ────────────────────────────────────────────────────────────────
  readonly catalogue = signal<CatalogueItem[]>([]);
  readonly catalogueLoading = signal(false);
  readonly catalogueError = signal(false);
  readonly categories = computed(() => {
    const seen = new Map<string, string>();
    for (const item of this.catalogue()) {
      if (item.categoryId && item.categoryName)
        seen.set(item.categoryId, item.categoryName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // ── Branches & shift ─────────────────────────────────────────────────────────
  readonly branches = signal<MyBranches['branches']>([]);
  /** The branch a new shift opens in: the cashier's default proposed, changeable before opening. */
  readonly branchId = signal<string | null>(null);
  readonly shift = signal<PosShift | null>(null);
  readonly shiftLoading = signal(true);
  /** Why the till cannot take a sale, as a catalogue key, when it cannot. */
  readonly shiftError = signal<string | null>(null);
  readonly shiftReady = computed(() => this.shift()?.status === 'OPEN');
  /** The open shift was opened by someone else: only a supervisor may ring on it or close it. */
  readonly shiftIsForeign = computed(() => {
    const shift = this.shift();
    const user = this.auth.user();
    return !!shift && !!user && shift.userId !== user.id;
  });
  readonly canSell = computed(
    () =>
      this.shiftReady() &&
      this.auth.canOperate() &&
      (!this.shiftIsForeign() || this.auth.canSupervise()),
  );
  readonly shiftBranchName = computed(() => {
    const id = this.shift()?.branchId;
    const branch = id ? this.branches().find((b) => b.id === id) : null;
    return branch ? `${branch.code} · ${branch.name}` : null;
  });

  // ── Ticket ───────────────────────────────────────────────────────────────────
  readonly lines = signal<CartLine[]>([]);
  /** Empty means the walk-in customer. */
  readonly customer = signal('');
  /** The buyer's RNC or cédula, for a crédito fiscal (E31). Empty: consumo (E32). */
  readonly customerTaxId = signal('');
  /** The line the keyboard acts on (+, −, Delete). */
  readonly selectedId = signal<string | null>(null);
  readonly totals = computed(() =>
    cartTotals(this.lines(), this.standardRate()),
  );
  readonly charging = signal(false);
  /** The sale just completed, for the receipt dialog. */
  readonly lastSale = signal<PosSale | null>(null);
  readonly parked = signal<ParkedTicket[]>(this.readParked());

  /**
   * The key the NEXT charge is sent with. It survives a failed attempt, so retrying the same cart
   * cannot ring it twice, and is replaced once the sale succeeds or the cart changes.
   */
  private saleKey = newIdempotencyKey();

  /** Everything the till needs before the first sale, in parallel. */
  init(): void {
    this.loadContext();
    this.loadCatalogue();
    this.loadBranches();
    this.loadShift();
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  loadContext(): void {
    this.api.context().subscribe({
      next: (context) => this.context.set(context),
      error: () => this.toast.error('pos.context_error'),
    });
  }

  loadCatalogue(): void {
    this.catalogueLoading.set(true);
    this.catalogueError.set(false);
    this.api
      .catalogue()
      .pipe(finalize(() => this.catalogueLoading.set(false)))
      .subscribe({
        next: (items) => {
          this.catalogue.set(items);
          // Keep the open ticket's prices and stock limits current with what was just read.
          this.lines.update((lines) => repriceCart(lines, items));
        },
        error: () => {
          this.catalogueError.set(true);
          this.toast.error('pos.load_products_error');
        },
      });
  }

  /** This device becomes another till: its shift and its parked tickets are that till's. */
  switchTerminal(id: string): boolean {
    if (!this.config.setTerminalId(id)) return false;
    this.parked.set(this.readParked());
    this.outbox.reload();
    this.loadShift();
    return true;
  }

  private loadBranches(): void {
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
  }

  /** Adopt the terminal's open shift, if it has one. Opening one is the cashier's act. */
  loadShift(): void {
    this.shiftLoading.set(true);
    this.shiftError.set(null);
    this.api
      .activeShift(this.terminalId())
      .pipe(finalize(() => this.shiftLoading.set(false)))
      .subscribe({
        next: (shift) => this.shift.set(shift),
        error: (err) => {
          this.shift.set(null);
          this.shiftError.set(this.errorKey(err, 'pos.shift_error'));
        },
      });
  }

  // ── Shift ────────────────────────────────────────────────────────────────────

  /** Open a shift with the float the cashier counted into the drawer. */
  openShift(openingBalance: number): Observable<PosShift> {
    this.shiftError.set(null);
    return this.api
      .openShift(this.terminalId(), openingBalance, this.branchId())
      .pipe(
        tap((shift) => {
          this.shift.set(shift);
          this.toast.success('pos.shift_opened');
        }),
        catchError((err) => {
          const key = this.errorKey(err, 'pos.open_shift_error');
          // Someone opened one meanwhile (another tab, another device on this terminal id): adopt it.
          if (key === 'pos.there_already_active_shift_for_this_terminal')
            this.loadShift();
          this.shiftError.set(key);
          this.toast.error(key);
          return throwError(() => err);
        }),
      );
  }

  /**
   * Close with the cash the cashier COUNTED. The till once sent the shift's sales total as the
   * closing balance, so the cash-up compared the takings with themselves and always balanced.
   */
  closeShift(countedCash: number): Observable<PosShift> {
    const shift = this.shift();
    if (!shift) return throwError(() => new Error('no shift'));
    return this.api.closeShift(shift.id, countedCash).pipe(
      tap((closed) => {
        this.shift.set(null);
        const variance = Number(closed?.closingVariance ?? 0);
        if (variance === 0) this.toast.success('pos.shift_closed');
        else this.toast.warning('pos.shift_closed_with_variance');
      }),
      catchError((err) => {
        this.toast.error(this.errorKey(err, 'pos.close_shift_error'));
        return throwError(() => err);
      }),
    );
  }

  report(shiftId: string): Observable<ShiftReport> {
    return this.api.shiftReport(shiftId);
  }

  // ── Ticket editing ───────────────────────────────────────────────────────────

  add(item: CatalogueItem, quantity = 1): boolean {
    if (isOutOfStock(item)) {
      this.toast.warning('pos.out_of_stock_named', { name: item.name });
      return false;
    }
    const change = addToCart(this.lines(), item, quantity);
    if (change.refused) {
      this.toast.warning('pos.not_enough_stock', {
        name: item.name,
        available: change.refused.available,
      });
      return false;
    }
    this.lines.set(change.lines);
    this.selectedId.set(item.id);
    this.cartChanged();
    return true;
  }

  /** A scan or a typed code: adds the exact match, if there is one. */
  addByCode(code: string): boolean {
    const item = findByCode(this.catalogue(), code);
    if (!item) return false;
    return this.add(item);
  }

  setQuantity(productId: string, quantity: number): void {
    const change = setQuantity(this.lines(), productId, quantity);
    if (change.refused) {
      const line = this.lines().find((l) => l.productId === productId);
      this.toast.warning('pos.not_enough_stock', {
        name: line?.name ?? '',
        available: change.refused.available,
      });
      return;
    }
    this.lines.set(change.lines);
    if (!change.lines.some((l) => l.productId === this.selectedId())) {
      this.selectedId.set(change.lines.at(-1)?.productId ?? null);
    }
    this.cartChanged();
  }

  increment(productId: string, delta: number): void {
    const line = this.lines().find((l) => l.productId === productId);
    if (line) this.setQuantity(productId, line.quantity + delta);
  }

  remove(productId: string): void {
    this.setQuantity(productId, 0);
  }

  clearTicket(): void {
    this.lines.set([]);
    this.customer.set('');
    this.customerTaxId.set('');
    this.selectedId.set(null);
    this.cartChanged();
  }

  // ── Parked tickets ───────────────────────────────────────────────────────────

  park(): boolean {
    if (this.lines().length === 0) return false;
    if (this.parked().length >= MAX_PARKED) {
      this.toast.warning('pos.park.limit', { max: MAX_PARKED });
      return false;
    }
    const ticket: ParkedTicket = {
      id: newIdempotencyKey(),
      lines: this.lines(),
      customer: this.customer(),
      parkedAt: new Date().toISOString(),
    };
    this.parked.update((list) => [...list, ticket]);
    this.writeParked();
    this.clearTicket();
    this.toast.info('pos.park.parked');
    return true;
  }

  /** Bring a parked ticket back. The open one, if any, is parked in its place. */
  recall(id: string): void {
    const ticket = this.parked().find((t) => t.id === id);
    if (!ticket) return;
    const current = this.lines().length
      ? {
          id: newIdempotencyKey(),
          lines: this.lines(),
          customer: this.customer(),
          parkedAt: new Date().toISOString(),
        }
      : null;
    this.parked.update((list) => [
      ...list.filter((t) => t.id !== id),
      ...(current ? [current] : []),
    ]);
    this.writeParked();
    // Re-priced against today's catalogue: a parked ticket may be hours old.
    this.lines.set(repriceCart(ticket.lines, this.catalogue()));
    this.customer.set(ticket.customer);
    this.selectedId.set(ticket.lines.at(-1)?.productId ?? null);
    this.cartChanged();
  }

  discardParked(id: string): void {
    this.parked.update((list) => list.filter((t) => t.id !== id));
    this.writeParked();
  }

  // ── Charging ─────────────────────────────────────────────────────────────────

  /**
   * Ring the ticket with these tenders. On success the ticket clears and the sale is kept for the
   * receipt; when the server says the catalogue moved under the till, the ticket is re-priced and
   * the error says so, so the cashier shows the customer the real amount and charges again.
   */
  charge(draft: TenderDraft): Observable<PosSale | null> {
    if (this.charging() || this.lines().length === 0) return of(null);
    const totals = this.totals();
    this.charging.set(true);
    const customer = this.customer().trim();
    const taxId = this.customerTaxId().replace(/\D/g, '');
    const payload: ProcessSalePayload = {
      terminalId: this.terminalId(),
      items: this.lines().map((line) => ({
        productId: line.productId,
        productName: line.name,
        price: line.price,
        quantity: line.quantity,
      })),
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      ...(customer ? { customerName: customer } : {}),
      ...(taxId ? { customerTaxId: taxId } : {}),
      payments: tenders(draft, totals.total),
    };
    const key = this.saleKey;

    // No connection: the counter keeps selling, and the outbox sends the sale when it returns.
    if (!this.connectivity.online()) {
      this.charging.set(false);
      return of(this.queueOffline(key, payload));
    }

    return this.api.processSale(payload, key).pipe(
      tap((sale) => {
        this.lastSale.set(sale);
        this.shift.update((shift) =>
          shift
            ? {
                ...shift,
                salesCount: shift.salesCount + 1,
                salesTotal:
                  Math.round(
                    (Number(shift.salesTotal) + Number(sale.total)) * 100,
                  ) / 100,
              }
            : shift,
        );
        this.resetAfterSale();
        this.toast.success('pos.sale_completed');
        // Reflect the stock the sale consumed.
        this.loadCatalogue();
        // Anything rung offline goes now that the server answers again.
        if (this.outbox.pending().length) void this.outbox.sync();
      }),
      catchError((err) => {
        // The request never reached the application: the sale is kept and sent later, with the
        // same key, so a sale whose response was the only thing lost is still rung once.
        if (isNetworkFailure(err)) return of(this.queueOffline(key, payload));
        const errorKey = this.errorKey(err, 'pos.sale_error');
        if (
          errorKey === 'pos.prices_changed' ||
          errorKey === 'pos.totals_changed' ||
          errorKey === 'pos.fiscal_total_mismatch' ||
          errorKey === 'pos.product_not_available'
        ) {
          this.loadCatalogue();
          this.cartChanged();
        }
        if (errorKey === 'pos.no_open_shift') this.loadShift();
        this.toast.error(errorKey);
        return throwError(() => err);
      }),
      finalize(() => this.charging.set(false)),
      map((sale) => sale as PosSale | null),
    );
  }

  /** Keep the sale on the device, show it as provisional, and start the next one. */
  private queueOffline(key: string, payload: ProcessSalePayload): PosSale {
    const entry = this.outbox.enqueue(key, payload);
    const sale = provisionalSale(entry, this.standardRate());
    this.lastSale.set(sale);
    this.resetAfterSale();
    this.toast.warning('pos.offline.queued');
    return sale;
  }

  private resetAfterSale(): void {
    this.lines.set([]);
    this.customer.set('');
    this.customerTaxId.set('');
    this.selectedId.set(null);
    this.saleKey = newIdempotencyKey();
  }

  // ── Journal ──────────────────────────────────────────────────────────────────

  sales(): Observable<PosSale[]> {
    const shift = this.shift();
    return shift ? this.api.listSales(shift.id) : of([]);
  }

  voidSale(sale: PosSale, reason: string): Observable<PosSale> {
    return this.api.voidSale(sale.id, reason, newIdempotencyKey()).pipe(
      tap((voided) => {
        this.shift.update((shift) =>
          shift
            ? {
                ...shift,
                salesCount: Math.max(0, shift.salesCount - 1),
                salesTotal:
                  Math.round(
                    (Number(shift.salesTotal) - Number(voided.total)) * 100,
                  ) / 100,
                voidedCount: (shift.voidedCount ?? 0) + 1,
              }
            : shift,
        );
        this.toast.success('pos.void.done');
        this.loadCatalogue();
      }),
      catchError((err) => {
        this.toast.error(this.errorKey(err, 'pos.void.error'));
        return throwError(() => err);
      }),
    );
  }

  /** Load both the report and the sales of the open shift (the X report screen). */
  shiftOverview(): Observable<{
    report: ShiftReport;
    sales: PosSale[];
  } | null> {
    const shift = this.shift();
    if (!shift) return of(null);
    return forkJoin({
      report: this.api.shiftReport(shift.id),
      sales: this.api.listSales(shift.id),
    });
  }

  /**
   * The key a failure is shown with, or the caller's own when the server said nothing specific.
   * Never the server's own sentence: it is written for whoever reads the logs, and forwarding it
   * is how an English string reached a Spanish till.
   */
  errorKey(err: unknown, fallback: string): string {
    const key = resolveErrorKey(
      err as HttpErrorResponse,
      (candidate) => this.translate.instant(candidate) !== candidate,
    );
    return key === 'errors.unexpected' ||
      /^errors\.http_(400|409|422)$/.test(key)
      ? fallback
      : key;
  }

  private cartChanged(): void {
    this.saleKey = newIdempotencyKey();
  }

  private readParked(): ParkedTicket[] {
    try {
      const raw = localStorage.getItem(
        `${PARKED_KEY}.${this.config.terminalId()}`,
      );
      const list = raw ? (JSON.parse(raw) as ParkedTicket[]) : [];
      return Array.isArray(list)
        ? list.filter((t) => t && Array.isArray(t.lines)).slice(0, MAX_PARKED)
        : [];
    } catch {
      return [];
    }
  }

  private writeParked(): void {
    try {
      localStorage.setItem(
        `${PARKED_KEY}.${this.config.terminalId()}`,
        JSON.stringify(this.parked()),
      );
    } catch {
      // Blocked storage: parked tickets last for this page load only.
    }
  }
}
