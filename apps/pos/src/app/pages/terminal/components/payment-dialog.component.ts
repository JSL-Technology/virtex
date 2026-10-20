import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule, Banknote, CreditCard, Landmark, Shuffle } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { PosSale } from '../../../core/pos-api.service';
import {
  PayMethod,
  TenderDraft,
  cashSuggestions,
  changeDue,
  paidSoFar,
  paymentError,
  startTender,
  stillOwed,
} from '../../../domain/payment';
import { TillStore } from '../../../state/till.store';
import { DialogComponent } from './dialog.component';

/** Refusals that mean the ticket on screen is no longer the one the server would ring. */
const TICKET_CHANGED = new Set(['pos.prices_changed', 'pos.totals_changed', 'pos.product_not_available', 'pos.no_open_shift']);

/**
 * Taking the payment (QA C-04).
 *
 * «Cobrar» once booked the sale the instant it was pressed: no tender, no cash received, no change,
 * no ticket — every sale counted as cash and the drawer never squared with the card terminal. Here
 * the cashier picks how the customer pays, keys what was handed over (or taps a common note), sees
 * the change, and confirms. Enter confirms; Escape goes back to the ticket.
 */
@Component({
  selector: 'pos-payment-dialog',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, DialogComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pos-dialog [title]="'pos.pay.title'" (closed)="cancelled.emit()" [dismissible]="!till.charging()">
      <div class="due">
        <span>{{ 'pos.amount_due' | translate }}</span>
        <strong class="num" data-testid="pos-pay-total">{{ total() | vxMoney: till.currency() }}</strong>
      </div>

      <div class="methods" role="radiogroup" [attr.aria-label]="'pos.pay.method_label' | translate">
        @for (m of methods; track m.id) {
          <button type="button" role="radio" class="method" [class.active]="draft().method === m.id" [attr.aria-checked]="draft().method === m.id" (click)="choose(m.id)" [attr.data-testid]="'pos-pay-' + m.id">
            <lucide-icon [img]="m.icon" size="22" aria-hidden="true" />
            {{ 'pos.pay.method.' + m.id | translate }}
          </button>
        }
      </div>

      @if (draft().method === 'mixed') {
        <label class="field">
          {{ 'pos.pay.card_part' | translate }}
          <input type="number" min="0" step="0.01" inputmode="decimal" cdkFocusInitial [value]="draft().card ?? ''" (input)="patch({ card: num($event) })" (keydown.enter)="confirm()" />
        </label>
      }

      @if (draft().method === 'cash' || draft().method === 'mixed') {
        <label class="field">
          {{ (draft().method === 'cash' ? 'pos.pay.cash_received' : 'pos.pay.cash_part') | translate }}
          <input class="cash-input num" cdkFocusInitial type="number" min="0" step="0.01" inputmode="decimal" [value]="draft().cash ?? ''" (input)="patch({ cash: num($event) })" (keydown.enter)="confirm()" data-testid="pos-pay-cash-input" />
        </label>
        @if (draft().method === 'cash') {
          <div class="quick" role="group" [attr.aria-label]="'pos.pay.quick_amounts' | translate">
            @for (amount of suggestions(); track amount) {
              <button type="button" class="btn btn-sm" [class.btn-primary]="draft().cash === amount" (click)="patch({ cash: amount })">{{ amount | vxMoney: till.currency() }}</button>
            }
          </div>
        }
      }

      @if (draft().method !== 'cash') {
        <label class="field">
          {{ 'pos.pay.reference' | translate }}
          <input type="text" maxlength="80" autocomplete="off" [value]="draft().reference" (input)="patch({ reference: $any($event.target).value })" (keydown.enter)="confirm()" />
          <span class="field-hint">{{ 'pos.pay.reference_hint' | translate }}</span>
        </label>
      }

      <dl class="kv summary">
        <div><dt>{{ 'pos.pay.paid' | translate }}</dt><dd>{{ paid() | vxMoney: till.currency() }}</dd></div>
        @if (owed() > 0) {
          <div class="owed"><dt>{{ 'pos.pay.still_owed' | translate }}</dt><dd>{{ owed() | vxMoney: till.currency() }}</dd></div>
        } @else {
          <div class="change"><dt>{{ 'pos.pay.change' | translate }}</dt><dd data-testid="pos-pay-change">{{ change() | vxMoney: till.currency() }}</dd></div>
        }
      </dl>
      @if (error(); as e) {
        <p class="alert alert-error" role="alert">{{ e | translate }}</p>
      }

      <ng-container dialog-actions>
        <button type="button" class="btn" (click)="cancelled.emit()" [disabled]="till.charging()">{{ 'pos.cancel' | translate }}</button>
        <button type="button" class="btn btn-success" [disabled]="!!error() || till.charging()" (click)="confirm()" data-testid="pos-pay-confirm">
          {{ (till.charging() ? 'pos.charging' : 'pos.pay.confirm') | translate: { amount: (total() | vxMoney: till.currency()) } }}
        </button>
      </ng-container>
    </pos-dialog>
  `,
  styles: [
    `
      .due { display: flex; justify-content: space-between; align-items: baseline; padding: 14px 16px; border-radius: 14px; background: var(--pos-bg); border: 1px solid var(--pos-border); }
      .due span { color: var(--pos-muted); }
      .due strong { font-size: 2rem; }
      .methods { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .method { display: flex; flex-direction: column; align-items: center; gap: 6px; min-height: 76px; justify-content: center; border-radius: 12px; border: 1px solid var(--pos-border-strong); background: var(--pos-surface-2); font-weight: 600; font-size: 0.88rem; color: var(--pos-muted); }
      .method.active { border-color: var(--pos-primary); background: color-mix(in srgb, var(--pos-primary) 18%, transparent); color: var(--pos-text); }
      .cash-input { font-size: 1.4rem !important; font-weight: 700; }
      .quick { display: flex; flex-wrap: wrap; gap: 8px; }
      .summary { padding: 12px 14px; border-radius: 12px; background: var(--pos-bg); font-size: 1.05rem; }
      .change dd { color: var(--pos-success); font-size: 1.4rem; }
      .owed dd { color: var(--pos-warning); font-size: 1.4rem; }
      .alert { margin: 0; }
      @media (max-width: 480px) { .methods { grid-template-columns: repeat(2, 1fr); } }
    `,
  ],
})
export class PaymentDialogComponent {
  protected readonly till = inject(TillStore);
  readonly cancelled = output<void>();
  readonly completed = output<PosSale>();

  protected readonly methods: Array<{ id: PayMethod; icon: typeof Banknote }> = [
    { id: 'cash', icon: Banknote },
    { id: 'card', icon: CreditCard },
    { id: 'transfer', icon: Landmark },
    { id: 'mixed', icon: Shuffle },
  ];

  protected readonly total = computed(() => this.till.totals().total);
  protected readonly draft = signal<TenderDraft>(startTender(this.till.totals().total));
  protected readonly paid = computed(() => paidSoFar(this.draft(), this.total()));
  protected readonly change = computed(() => changeDue(this.draft(), this.total()));
  protected readonly owed = computed(() => stillOwed(this.draft(), this.total()));
  protected readonly error = computed(() => paymentError(this.draft(), this.total()));
  protected readonly suggestions = computed(() => cashSuggestions(this.total()));

  protected choose(method: PayMethod): void {
    const total = this.total();
    this.draft.update((d) => ({
      ...d,
      method,
      cash: method === 'cash' ? total : method === 'mixed' ? null : d.cash,
      card: method === 'mixed' ? null : d.card,
    }));
  }

  protected patch(change: Partial<TenderDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
  }

  protected num(event: Event): number | null {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    return Number.isFinite(value) ? value : null;
  }

  protected confirm(): void {
    if (this.error() || this.till.charging()) return;
    this.till.charge(this.draft()).subscribe({
      next: (sale) => sale && this.completed.emit(sale),
      // The store has already said why. When the ticket itself changed (re-priced, a product
      // withdrawn, the shift gone) the cashier goes back to it; otherwise — a dropped connection —
      // the dialog stays, and charging again resends the same idempotency key, never a second sale.
      error: (err) => {
        if (TICKET_CHANGED.has(this.till.errorKey(err, 'pos.sale_error'))) this.cancelled.emit();
      },
    });
  }
}
