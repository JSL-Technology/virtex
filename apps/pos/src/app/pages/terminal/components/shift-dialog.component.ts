import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../../core/auth.service';
import { DocumentsService } from '../../../core/documents.service';
import { ShiftReport, TenderMethod } from '../../../core/pos-api.service';
import { ToastService } from '../../../core/toast.service';
import { round2 } from '../../../domain/money';
import { TillStore } from '../../../state/till.store';
import { DialogComponent } from './dialog.component';

/**
 * The shift: its X report while open, the cash-up, and the Z report once closed.
 *
 * The cashier counts the drawer and types what is there; the till shows the expected amount and the
 * difference as they type, so a miscount is caught before it is recorded rather than explained after.
 */
@Component({
  selector: 'pos-shift-dialog',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslateModule,
    DialogComponent,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pos-dialog
      [title]="closedReport() ? 'pos.report.z_title' : 'pos.report.x_title'"
      [wide]="true"
      (closed)="closed.emit()"
      [dismissible]="!closing()"
    >
      @if (loading()) {
        <p class="muted">{{ 'pos.report.loading' | translate }}</p>
      } @else if (report(); as r) {
        <div class="stats">
          <div class="stat">
            <span>{{ 'pos.report.sales_count' | translate }}</span
            ><strong class="num">{{ r.salesCount }}</strong>
          </div>
          <div class="stat">
            <span>{{ 'pos.total' | translate }}</span
            ><strong class="num">{{
              r.total | vxMoney: till.currency()
            }}</strong>
          </div>
          <div class="stat">
            <span>{{ 'pos.report.average_ticket' | translate }}</span
            ><strong class="num">{{
              r.averageTicket | vxMoney: till.currency()
            }}</strong>
          </div>
          <div class="stat">
            <span>{{ 'pos.report.items_sold' | translate }}</span
            ><strong class="num">{{ r.itemsSold }}</strong>
          </div>
        </div>

        <div class="cols">
          <section>
            <h3>{{ 'pos.report.by_method' | translate }}</h3>
            <dl class="kv">
              @for (m of methods; track m) {
                <div>
                  <dt>{{ 'pos.pay.method.' + m | translate }}</dt>
                  <dd>{{ r.byMethod[m] | vxMoney: till.currency() }}</dd>
                </div>
              }
              <div>
                <dt>{{ 'pos.taxes' | translate }}</dt>
                <dd>{{ r.tax | vxMoney: till.currency() }}</dd>
              </div>
              <div>
                <dt>
                  {{
                    'pos.report.voided' | translate: { count: r.voidedCount }
                  }}
                </dt>
                <dd>{{ r.voidedTotal | vxMoney: till.currency() }}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>{{ 'pos.report.top_products' | translate }}</h3>
            @if (r.topProducts.length) {
              <ol class="top">
                @for (p of r.topProducts.slice(0, 5); track p.productId) {
                  <li>
                    <span>{{ p.quantity }} × {{ p.productName }}</span
                    ><span class="num">{{
                      p.total | vxMoney: till.currency()
                    }}</span>
                  </li>
                }
              </ol>
            } @else {
              <p class="muted">{{ 'pos.report.no_sales' | translate }}</p>
            }
          </section>
        </div>

        <section class="cashup">
          <h3>{{ 'pos.report.cash_up' | translate }}</h3>
          <dl class="kv">
            <div>
              <dt>{{ 'pos.report.opening_float' | translate }}</dt>
              <dd>{{ r.shift.openingBalance | vxMoney: till.currency() }}</dd>
            </div>
            <div>
              <dt>{{ 'pos.report.cash_sales' | translate }}</dt>
              <dd>{{ r.byMethod.cash | vxMoney: till.currency() }}</dd>
            </div>
            <div class="strong">
              <dt>{{ 'pos.report.expected_cash' | translate }}</dt>
              <dd>{{ expected() | vxMoney: till.currency() }}</dd>
            </div>
            @if (closedReport()) {
              <div>
                <dt>{{ 'pos.counted_cash' | translate }}</dt>
                <dd>{{ r.shift.closingBalance | vxMoney: till.currency() }}</dd>
              </div>
              <div
                class="strong"
                [class.bad]="(r.shift.closingVariance ?? 0) !== 0"
              >
                <dt>{{ 'pos.report.variance' | translate }}</dt>
                <dd>
                  {{ r.shift.closingVariance | vxMoney: till.currency() }}
                </dd>
              </div>
            }
          </dl>
          @if (!closedReport()) {
            @if (mayClose()) {
              <label class="field">
                {{ 'pos.counted_cash' | translate }}
                <input
                  class="count num"
                  cdkFocusInitial
                  type="number"
                  min="0"
                  step="0.01"
                  inputmode="decimal"
                  [value]="counted() ?? ''"
                  (input)="setCounted($event)"
                  (keydown.enter)="close()"
                  data-testid="pos-counted-cash"
                />
              </label>
              @if (variance() !== null) {
                <p
                  class="variance"
                  [class.bad]="variance() !== 0"
                  role="status"
                >
                  @if (variance() === 0) {
                    {{ 'pos.report.balanced' | translate }}
                  } @else if (variance()! > 0) {
                    {{
                      'pos.report.over'
                        | translate
                          : { amount: (variance() | vxMoney: till.currency()) }
                    }}
                  } @else {
                    {{
                      'pos.report.short'
                        | translate
                          : {
                              amount: (-variance()! | vxMoney: till.currency()),
                            }
                    }}
                  }
                </p>
              }
            } @else {
              <p class="alert alert-info">
                {{ 'pos.shift_belongs_to_another_cashier' | translate }}
              </p>
            }
          }
        </section>
      }

      <ng-container dialog-actions>
        @if (report()) {
          <button type="button" class="btn" (click)="print()">
            <lucide-icon [img]="PrintIcon" size="16" aria-hidden="true" />
            {{ 'pos.report.print' | translate }}
          </button>
        }
        @if (closedReport()) {
          <button type="button" class="btn btn-primary" (click)="closed.emit()">
            {{ 'pos.report.done' | translate }}
          </button>
        } @else {
          <button
            type="button"
            class="btn"
            (click)="closed.emit()"
            [disabled]="closing()"
          >
            {{ 'pos.cancel' | translate }}
          </button>
          @if (mayClose()) {
            <button
              type="button"
              class="btn btn-danger"
              [disabled]="variance() === null || closing()"
              (click)="close()"
              data-testid="pos-confirm-close"
            >
              {{
                (closing() ? 'pos.closing_shift' : 'pos.confirm_close_shift')
                  | translate
              }}
            </button>
          }
        }
      </ng-container>
    </pos-dialog>
  `,
  styles: [
    `
      .muted {
        color: var(--pos-muted);
        margin: 0;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
      }
      .stat {
        background: var(--pos-bg);
        border: 1px solid var(--pos-border);
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .stat span {
        color: var(--pos-muted);
        font-size: 0.8rem;
      }
      .stat strong {
        font-size: 1.3rem;
      }
      .cols {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      h3 {
        margin: 0 0 8px;
        font-size: 0.95rem;
        color: var(--pos-muted);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .top {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }
      .top li {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .cashup {
        border-top: 1px solid var(--pos-border);
        padding-top: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .strong {
        font-size: 1.1rem;
      }
      .strong dt {
        color: var(--pos-text) !important;
        font-weight: 700;
      }
      .bad dd,
      .variance.bad {
        color: var(--pos-warning);
      }
      .count {
        font-size: 1.4rem !important;
        font-weight: 700;
      }
      .variance {
        margin: 0;
        font-weight: 700;
        color: var(--pos-success);
      }
      .alert {
        margin: 0;
      }
      @media (max-width: 720px) {
        .stats {
          grid-template-columns: repeat(2, 1fr);
        }
        .cols {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class ShiftDialogComponent {
  protected readonly till = inject(TillStore);
  private readonly auth = inject(AuthService);
  private readonly documents = inject(DocumentsService);
  private readonly toast = inject(ToastService);
  readonly closed = output<void>();

  protected readonly PrintIcon = Printer;
  protected readonly methods: TenderMethod[] = [
    'cash',
    'card',
    'transfer',
    'other',
  ];

  protected readonly loading = signal(true);
  protected readonly report = signal<ShiftReport | null>(null);
  protected readonly counted = signal<number | null>(null);
  protected readonly closing = signal(false);
  protected readonly closedReport = computed(
    () => this.report()?.shift.status === 'CLOSED',
  );
  protected readonly expected = computed(() => {
    const r = this.report();
    if (!r) return 0;
    return this.closedReport() && r.shift.expectedBalance != null
      ? r.shift.expectedBalance
      : r.expectedCash;
  });
  protected readonly variance = computed(() => {
    const counted = this.counted();
    return counted === null ? null : round2(counted - this.expected());
  });
  /** The cashier who opened the shift, or a supervisor. The server checks the same thing. */
  protected readonly mayClose = computed(
    () => !this.till.shiftIsForeign() || this.auth.canSupervise(),
  );

  constructor() {
    const shift = this.till.shift();
    if (!shift) {
      this.loading.set(false);
      return;
    }
    this.load(shift.id);
  }

  protected setCounted(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.counted.set(Number.isFinite(value) && value >= 0 ? value : null);
  }

  protected close(): void {
    const counted = this.counted();
    const shiftId = this.report()?.shift.id;
    if (counted === null || this.closing() || !shiftId) return;
    this.closing.set(true);
    this.till.closeShift(round2(counted)).subscribe({
      next: () => {
        this.closing.set(false);
        // The Z report: the closed shift, with its counted cash and variance.
        this.load(shiftId);
      },
      error: () => this.closing.set(false),
    });
  }

  protected print(): void {
    const report = this.report();
    if (report) void this.documents.printReport(report);
  }

  private load(shiftId: string): void {
    this.loading.set(true);
    this.till.report(shiftId).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(this.till.errorKey(err, 'pos.report.error'));
      },
    });
  }
}
