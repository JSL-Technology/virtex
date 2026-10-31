import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import {
  LucideAngularModule,
  Minus,
  Plus,
  Trash2,
  ShoppingCart,
  CreditCard,
  PauseCircle,
  PlayCircle,
  UserRound,
  IdCard,
  Lock,
  Eraser,
} from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../../core/auth.service';
import { lineTotal } from '../../../domain/cart';
import { TillStore } from '../../../state/till.store';

/**
 * The open ticket: who it is for, what is on it, what it comes to — and, while the till has no
 * shift, the form that opens one. Charging is never offered on a till that cannot record the sale:
 * the web client's version once rendered a complete point of sale, «Connected» indicator and all,
 * on a till whose shift had failed to open.
 */
@Component({
  selector: 'pos-ticket-panel',
  standalone: true,
  imports: [FormsModule, ...VX_FORM_A11Y, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2>{{ 'pos.current_order' | translate }}</h2>
      <div class="head__actions">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          (click)="recallRequested.emit()"
          [disabled]="till.parked().length === 0"
          [title]="'pos.park.recall' | translate"
        >
          <lucide-icon [img]="RecallIcon" size="16" aria-hidden="true" />
          {{ 'pos.park.recall' | translate }}
          @if (till.parked().length) {
            <span class="count">{{ till.parked().length }}</span>
          }
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          (click)="till.park()"
          [disabled]="till.lines().length === 0"
          [title]="'pos.park.park' | translate"
        >
          <lucide-icon [img]="ParkIcon" size="16" aria-hidden="true" />
          {{ 'pos.park.park' | translate }} <kbd aria-hidden="true">F8</kbd>
        </button>
      </div>
    </header>

    <label class="customer">
      <lucide-icon [img]="UserIcon" size="16" aria-hidden="true" />
      <span class="sr-only">{{ 'pos.customer' | translate }}</span>
      <input
        type="text"
        maxlength="255"
        autocomplete="off"
        [placeholder]="'pos.walk_in_customer' | translate"
        [ngModel]="till.customer()"
        (ngModelChange)="till.customer.set($event)"
        data-testid="pos-customer"
      />
    </label>
    @if (till.fiscal()) {
      <label class="customer">
        <lucide-icon [img]="TaxIdIcon" size="16" aria-hidden="true" />
        <span class="sr-only">{{ 'pos.buyer_tax_id' | translate }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="13"
          autocomplete="off"
          [placeholder]="'pos.buyer_tax_id_placeholder' | translate"
          [ngModel]="till.customerTaxId()"
          (ngModelChange)="till.customerTaxId.set($event)"
          data-testid="pos-customer-tax-id"
        />
        <span class="doc-kind">{{
          (till.customerTaxId().replace(nonDigits, '') ? 'pos.document_kind.credit' : 'pos.document_kind.consumer') | translate
        }}</span>
      </label>
    }

    <div
      class="lines"
      role="list"
      [attr.aria-label]="'pos.current_order' | translate"
      data-testid="pos-ticket-lines"
    >
      @for (line of till.lines(); track line.productId) {
        <div
          class="line"
          role="listitem"
          [class.line--selected]="till.selectedId() === line.productId"
          (click)="till.selectedId.set(line.productId)"
        >
          <div class="line__info">
            <span class="line__name">{{ line.name }}</span>
            <span class="line__unit num"
              >{{ line.price | vxMoney: till.currency() }}
              @if (line.taxRate === 0 && till.standardRate() > 0) {
                · {{ 'pos.tax_exempt' | translate }}
              }
            </span>
          </div>
          <div class="qty">
            <button
              type="button"
              class="icon-btn"
              (click)="
                till.increment(line.productId, -1); $event.stopPropagation()
              "
              [attr.aria-label]="
                'pos.decrease_qty' | translate: { name: line.name }
              "
            >
              <lucide-icon [img]="MinusIcon" size="14" aria-hidden="true" />
            </button>
            <input
              type="number"
              class="qty__input num"
              min="1"
              inputmode="numeric"
              [value]="line.quantity"
              (change)="
                till.setQuantity(
                  line.productId,
                  $any($event.target).valueAsNumber
                )
              "
              (click)="$event.stopPropagation()"
              [attr.aria-label]="
                'pos.quantity_of' | translate: { name: line.name }
              "
            />
            <button
              type="button"
              class="icon-btn"
              (click)="
                till.increment(line.productId, 1); $event.stopPropagation()
              "
              [attr.aria-label]="
                'pos.increase_qty' | translate: { name: line.name }
              "
            >
              <lucide-icon [img]="PlusIcon" size="14" aria-hidden="true" />
            </button>
          </div>
          <span class="line__total num">{{
            total(line) | vxMoney: till.currency()
          }}</span>
          <button
            type="button"
            class="icon-btn remove"
            (click)="till.remove(line.productId); $event.stopPropagation()"
            [attr.aria-label]="
              'pos.remove_item' | translate: { name: line.name }
            "
          >
            <lucide-icon [img]="TrashIcon" size="16" aria-hidden="true" />
          </button>
        </div>
      } @empty {
        <div class="empty">
          <lucide-icon [img]="CartIcon" size="44" aria-hidden="true" />
          <p>{{ 'pos.empty_order' | translate }}</p>
          <p class="hint">{{ 'pos.scan_hint' | translate }}</p>
        </div>
      }
    </div>

    <footer class="foot">
      <dl class="kv totals">
        <div>
          <dt>{{ 'pos.subtotal' | translate }}</dt>
          <dd>{{ till.totals().subtotal | vxMoney: till.currency() }}</dd>
        </div>
        <div>
          <dt>
            @if (till.totals().rate !== null) {
              {{
                'pos.tax_at_rate'
                  | translate: { rate: (till.totals().rate | vxPercent) }
              }}
            } @else {
              {{ 'pos.taxes' | translate }}
            }
          </dt>
          <dd>{{ till.totals().tax | vxMoney: till.currency() }}</dd>
        </div>
        <div class="grand">
          <dt>{{ 'pos.total' | translate }}</dt>
          <dd data-testid="pos-total">
            {{ till.totals().total | vxMoney: till.currency() }}
          </dd>
        </div>
      </dl>

      @if (till.taxNeedsConfiguration()) {
        <p class="alert alert-warning">
          {{ 'pos.tax_needs_configuration' | translate }}
        </p>
      }

      @if (till.shiftLoading()) {
        <p class="muted">{{ 'pos.loading_shift' | translate }}</p>
      } @else if (!till.shiftReady()) {
        <!-- The till takes no sale until a shift is open: the drawer needs someone accountable. -->
        <form
          class="open-shift"
          (ngSubmit)="openShift()"
          data-testid="pos-open-shift"
        >
          <p class="open-shift__title">
            <lucide-icon [img]="LockIcon" size="16" aria-hidden="true" />
            {{ 'pos.shift_blocked_title' | translate }}
          </p>
          @if (till.shiftError(); as error) {
            <p class="alert alert-error" role="alert">
              {{ error | translate }}
            </p>
          } @else {
            <p class="muted">{{ 'pos.open_shift_help' | translate }}</p>
          }
          <div class="open-shift__row">
            <label class="field">
              {{ 'pos.opening_float' | translate }}
              <input
                type="number"
                name="float"
                min="0"
                step="0.01"
                inputmode="decimal"
                [(ngModel)]="openingFloat"
                required
                data-testid="pos-opening-float"
              />
            </label>
            @if (till.branches().length > 1) {
              <label class="field">
                {{ 'pos.branch' | translate }}
                <select
                  name="branch"
                  [ngModel]="till.branchId()"
                  (ngModelChange)="till.branchId.set($event || null)"
                >
                  @if (!till.branchId()) {
                    <option [ngValue]="null" disabled>
                      {{ 'pos.choose_branch' | translate }}
                    </option>
                  }
                  @for (branch of till.branches(); track branch.id) {
                    <option [ngValue]="branch.id">
                      {{ branch.code }} · {{ branch.name }}
                    </option>
                  }
                </select>
              </label>
            }
          </div>
          @if (!auth.canOperate()) {
            <p class="alert alert-info">{{ 'pos.view_only' | translate }}</p>
          }
          <button
            type="submit"
            class="btn btn-primary btn-lg"
            [disabled]="opening() || !auth.canOperate() || !validFloat()"
          >
            {{
              (opening() ? 'pos.opening_shift' : 'pos.open_shift') | translate
            }}
          </button>
        </form>
      } @else {
        @if (till.shiftIsForeign()) {
          <p class="alert alert-warning">
            {{
              (auth.canSupervise()
                ? 'pos.foreign_shift_supervisor'
                : 'pos.shift_belongs_to_another_cashier'
              ) | translate
            }}
          </p>
        }
        <div class="actions">
          <button
            type="button"
            class="btn btn-danger"
            (click)="till.clearTicket()"
            [disabled]="till.lines().length === 0"
            [attr.aria-label]="'pos.clear_ticket' | translate"
            [title]="'pos.clear_ticket' | translate"
          >
            <lucide-icon [img]="ClearIcon" size="18" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="btn btn-success btn-lg charge"
            (click)="chargeRequested.emit()"
            [disabled]="
              till.lines().length === 0 || !till.canSell() || till.charging()
            "
            data-testid="pos-charge"
          >
            <lucide-icon [img]="CardIcon" size="20" aria-hidden="true" />
            <span>{{
              'pos.charge'
                | translate
                  : { amount: (till.totals().total | vxMoney: till.currency()) }
            }}</span>
            <kbd aria-hidden="true">F9</kbd>
          </button>
        </div>
      }
    </footer>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--pos-surface);
        border-left: 1px solid var(--pos-border);
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 14px 16px 6px;
      }
      .head h2 {
        margin: 0;
        font-size: 1.05rem;
      }
      .head__actions {
        display: flex;
        gap: 4px;
      }
      .count {
        display: inline-grid;
        place-items: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--pos-primary);
        color: #fff;
        font-size: 0.72rem;
      }
      .customer {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 6px 16px 8px;
        padding: 0 12px;
        min-height: 44px;
        border: 1px solid var(--pos-border-strong);
        border-radius: var(--pos-radius);
        background: var(--pos-bg);
        color: var(--pos-muted);
      }
      .customer:focus-within {
        border-color: var(--pos-primary);
        box-shadow: var(--pos-focus);
      }
      .customer input {
        flex: 1;
        background: transparent;
        border: 0;
        outline: none;
        min-width: 0;
      }
      .customer input:focus-visible {
        box-shadow: none;
      }
      .doc-kind {
        font-size: 0.72rem;
        white-space: nowrap;
      }
      .lines {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 4px 8px;
      }
      .line {
        display: grid;
        grid-template-columns: 1fr auto auto auto;
        align-items: center;
        gap: 8px;
        padding: 10px 8px;
        border-radius: 10px;
        border: 1px solid transparent;
        cursor: default;
      }
      .line + .line {
        border-top-color: var(--pos-border);
        border-top-left-radius: 0;
        border-top-right-radius: 0;
      }
      .line--selected {
        background: var(--pos-surface-2);
        border-color: var(--pos-border-strong) !important;
        border-radius: 10px !important;
      }
      .line__info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .line__name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .line__unit {
        color: var(--pos-faint);
        font-size: 0.8rem;
      }
      .line__total {
        font-weight: 700;
        min-width: 84px;
        text-align: right;
      }
      .qty {
        display: flex;
        align-items: center;
        gap: 2px;
        background: var(--pos-bg);
        border: 1px solid var(--pos-border);
        border-radius: 10px;
      }
      .qty__input {
        width: 46px;
        text-align: center;
        background: transparent;
        border: 0;
        color: var(--pos-text);
        font-weight: 700;
        -moz-appearance: textfield;
      }
      .qty__input::-webkit-inner-spin-button {
        -webkit-appearance: none;
      }
      .remove:hover {
        color: var(--pos-danger) !important;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        min-height: 180px;
        color: var(--pos-faint);
        text-align: center;
        gap: 6px;
      }
      .empty p {
        margin: 0;
      }
      .hint {
        font-size: 0.82rem;
      }
      .foot {
        border-top: 1px solid var(--pos-border);
        padding: 14px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: var(--pos-surface);
      }
      .totals .grand {
        padding-top: 8px;
        border-top: 1px dashed var(--pos-border-strong);
        font-size: 1.5rem;
      }
      .totals .grand dt {
        color: var(--pos-text);
        font-weight: 700;
      }
      .totals .grand dd {
        font-weight: 800;
      }
      .muted {
        color: var(--pos-muted);
        margin: 0;
        font-size: 0.9rem;
      }
      .open-shift {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .open-shift__title {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-weight: 700;
        color: var(--pos-warning);
      }
      .open-shift__row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 10px;
      }
      .alert {
        margin: 0;
      }
      .actions {
        display: flex;
        gap: 10px;
      }
      .actions .btn-danger {
        min-height: 60px;
        width: 60px;
        padding: 0;
        border-radius: 14px;
      }
      .charge {
        flex: 1;
      }
      .charge kbd {
        background: rgb(0 0 0 / 0.15);
        color: inherit;
        border-color: rgb(0 0 0 / 0.25);
      }
    `,
  ],
})
export class TicketPanelComponent {
  protected readonly till = inject(TillStore);
  protected readonly auth = inject(AuthService);

  readonly chargeRequested = output<void>();
  readonly recallRequested = output<void>();

  protected readonly MinusIcon = Minus;
  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;
  protected readonly CartIcon = ShoppingCart;
  protected readonly CardIcon = CreditCard;
  protected readonly ParkIcon = PauseCircle;
  protected readonly RecallIcon = PlayCircle;
  protected readonly UserIcon = UserRound;
  protected readonly TaxIdIcon = IdCard;
  protected readonly nonDigits = /\D/g;
  protected readonly LockIcon = Lock;
  protected readonly ClearIcon = Eraser;

  protected openingFloat: number | null = 0;
  protected readonly opening = signal(false);

  protected total = lineTotal;

  protected validFloat(): boolean {
    const value = Number(this.openingFloat);
    return this.openingFloat !== null && Number.isFinite(value) && value >= 0;
  }

  protected openShift(): void {
    if (this.opening() || !this.validFloat()) return;
    this.opening.set(true);
    this.till
      .openShift(Math.round(Number(this.openingFloat) * 100) / 100)
      .subscribe({
        next: () => this.opening.set(false),
        error: () => this.opening.set(false),
      });
  }
}
