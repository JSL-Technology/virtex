import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { resolveErrorKey } from '@virteex/shared/ui-i18n';
import { TranslateService } from '@ngx-translate/core';
import { ConnectivityService } from './connectivity.service';
import { PosApiService, PosSale, ProcessSalePayload } from './pos-api.service';
import { TerminalConfigService } from './terminal-config.service';

/** A sale captured while the till could not reach the server. */
export interface OutboxEntry {
  /** The sale's idempotency key — the same one every retry sends, so it is rung once. */
  key: string;
  payload: ProcessSalePayload;
  queuedAt: string;
  attempts: number;
  /** Set when the server refused the sale (not a network failure): it needs a person. */
  failedKey: string | null;
}

const OUTBOX_KEY = 'virtex.pos.outbox';
/** How often the till tries to empty the outbox while it is online. */
const SYNC_INTERVAL_MS = 30_000;

/**
 * Contingency: sales the till rang while offline, kept on the device and sent when it reconnects.
 *
 * The counter must not stop because the internet did. A sale that cannot reach the server is kept
 * here — in `localStorage`, so it survives a reload — with the moment it was rung and the
 * idempotency key it will always be sent with. When the connection returns the entries are sent
 * in order; the server issues each one's fiscal document dated the day it was rung, and the key
 * guarantees that a sale whose response was lost is not rung twice.
 *
 * A sale the server REFUSES (a product withdrawn, a buyer's RNC that fails its check digit) is not
 * retried forever: it is marked failed and shown to the cashier, who fixes and re-rings it or
 * discards it.
 */
@Injectable({ providedIn: 'root' })
export class OutboxService {
  private readonly api = inject(PosApiService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly config = inject(TerminalConfigService);
  private readonly translate = inject(TranslateService);

  readonly entries = signal<OutboxEntry[]>(this.read());
  readonly pending = computed(() => this.entries().filter((e) => !e.failedKey));
  readonly failed = computed(() => this.entries().filter((e) => e.failedKey));
  readonly syncing = signal(false);

  /** Called with each sale the server accepted from the outbox. */
  onSynced: ((sale: PosSale) => void) | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    const online = () => void this.sync();
    window.addEventListener('online', online);
    const timer = setInterval(() => {
      if (this.connectivity.online() && this.pending().length) void this.sync();
    }, SYNC_INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', online);
      clearInterval(timer);
    });
  }

  /** This device became another till: its outbox is that till's. */
  reload(): void {
    this.entries.set(this.read());
  }

  enqueue(key: string, payload: ProcessSalePayload): OutboxEntry {
    const entry: OutboxEntry = {
      key,
      payload: { ...payload, capturedAt: payload.capturedAt ?? new Date().toISOString() },
      queuedAt: new Date().toISOString(),
      attempts: 0,
      failedKey: null,
    };
    this.entries.update((list) => [...list.filter((e) => e.key !== key), entry]);
    this.write();
    return entry;
  }

  discard(key: string): void {
    this.entries.update((list) => list.filter((e) => e.key !== key));
    this.write();
  }

  retry(key: string): void {
    this.entries.update((list) =>
      list.map((e) => (e.key === key ? { ...e, failedKey: null } : e)),
    );
    this.write();
    void this.sync();
  }

  /** Send what is waiting, oldest first. Stops at the first network failure. */
  async sync(): Promise<void> {
    if (this.syncing() || !this.connectivity.online()) return;
    this.syncing.set(true);
    try {
      for (const entry of this.pending()) {
        try {
          const sale = await firstValueFrom(this.api.processSale(entry.payload, entry.key));
          this.discard(entry.key);
          this.onSynced?.(sale);
        } catch (err) {
          if (isNetworkFailure(err)) {
            this.bump(entry.key, null);
            return;
          }
          const key = resolveErrorKey(
            err as HttpErrorResponse,
            (candidate) => this.translate.instant(candidate) !== candidate,
          );
          this.bump(entry.key, key || 'pos.sale_error');
        }
      }
    } finally {
      this.syncing.set(false);
    }
  }

  private bump(key: string, failedKey: string | null): void {
    this.entries.update((list) =>
      list.map((e) => (e.key === key ? { ...e, attempts: e.attempts + 1, failedKey } : e)),
    );
    this.write();
  }

  private storageKey(): string {
    return `${OUTBOX_KEY}.${this.config.terminalId()}`;
  }

  private read(): OutboxEntry[] {
    try {
      const raw = localStorage.getItem(this.storageKey());
      const list = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
      return Array.isArray(list) ? list.filter((e) => e && e.key && e.payload) : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.entries()));
    } catch {
      // Storage full or blocked: the entries stay in memory for this page load.
    }
  }
}

/**
 * The request never got an answer from the application: no connection, a dropped one, or a
 * gateway that could not reach the API. Those are retried; anything the API itself answered is not.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) return false;
  return err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504;
}

/** What the till shows and prints for a sale waiting in the outbox. */
export function provisionalSale(entry: OutboxEntry, standardRate: number): PosSale {
  const p = entry.payload;
  return {
    id: entry.key,
    terminalId: p.terminalId,
    shiftId: null,
    cashierId: null,
    items: p.items.map((line) => {
      const lineSubtotal = Math.round(line.price * line.quantity * 100) / 100;
      return {
        productId: line.productId,
        productName: line.productName,
        price: line.price,
        quantity: line.quantity,
        taxRate: standardRate,
        lineSubtotal,
        lineTax: 0,
      };
    }),
    subtotal: p.subtotal,
    tax: p.tax,
    total: p.total,
    paymentMethod: null,
    customerName: p.customerName ?? null,
    customerTaxId: p.customerTaxId ?? null,
    payments: p.payments,
    amountTendered: null,
    changeDue: Math.max(
      0,
      Math.round((p.payments.reduce((sum, t) => sum + t.amount, 0) - p.total) * 100) / 100,
    ),
    status: 'PENDING_SYNC',
    createdAt: p.capturedAt ?? entry.queuedAt,
    capturedAt: p.capturedAt ?? entry.queuedAt,
  };
}
