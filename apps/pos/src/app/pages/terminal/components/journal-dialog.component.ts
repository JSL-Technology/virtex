import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule, Printer, Ban, Search } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../../core/auth.service';
import { DocumentsService } from '../../../core/documents.service';
import { PosSale } from '../../../core/pos-api.service';
import { ToastService } from '../../../core/toast.service';
import { TillStore } from '../../../state/till.store';
import { DialogComponent } from './dialog.component';

/**
 * The shift's sales: find a ticket, reprint it, and — as a supervisor — void it with a reason.
 *
 * A void is the supervisor's act because it puts money back out of the takings; the server enforces
 * `pos:manage_shifts`, and refuses on a shift that has already been cashed up.
 */
@Component({
  selector: 'pos-journal-dialog',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, DialogComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pos-dialog [title]="'pos.journal.title'" [wide]="true" (closed)="closed.emit()">
      <label class="search">
        <lucide-icon [img]="SearchIcon" size="16" aria-hidden="true" />
        <span class="sr-only">{{ 'pos.journal.search' | translate }}</span>
        <input type="search" [placeholder]="'pos.journal.search' | translate" [value]="query()" (input)="query.set($any($event.target).value)" />
      </label>

      @if (loading()) {
        <p class="muted">{{ 'pos.journal.loading' | translate }}</p>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{{ 'pos.journal.time' | translate }}</th>
                <th scope="col">{{ 'pos.ticket.number_label' | translate }}</th>
                <th scope="col">{{ 'pos.customer' | translate }}</th>
                <th scope="col">{{ 'pos.journal.method' | translate }}</th>
                <th scope="col" class="r">{{ 'pos.total' | translate }}</th>
                <th scope="col"><span class="sr-only">{{ 'pos.journal.actions' | translate }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (sale of visible(); track sale.id) {
                <tr [class.voided]="sale.status === 'CANCELLED'">
                  <td class="num">{{ sale.createdAt | vxDate: 'time' }}</td>
                  <td class="mono">{{ sale.id.slice(0, 8).toUpperCase() }}</td>
                  <td>{{ sale.customerName || ('pos.walk_in_customer' | translate) }}</td>
                  <td>
                    @if (sale.status === 'CANCELLED') {
                      <span class="tag tag--void">{{ 'pos.sale_status.cancelled' | translate }}</span>
                    } @else {
                      {{ 'pos.pay.method.' + (sale.paymentMethod || 'cash') | translate }}
                    }
                  </td>
                  <td class="r num strong">{{ sale.total | vxMoney: till.currency() }}</td>
                  <td class="row-actions">
                    <button type="button" class="icon-btn" (click)="print(sale)" [attr.aria-label]="'pos.ticket.print' | translate" [title]="'pos.ticket.print' | translate">
                      <lucide-icon [img]="PrintIcon" size="16" aria-hidden="true" />
                    </button>
                    @if (auth.canSupervise() && sale.status === 'PAID') {
                      <button type="button" class="icon-btn danger" (click)="startVoid(sale)" [attr.aria-label]="'pos.void.action' | translate" [title]="'pos.void.action' | translate">
                        <lucide-icon [img]="VoidIcon" size="16" aria-hidden="true" />
                      </button>
                    }
                  </td>
                </tr>
                @if (voiding()?.id === sale.id) {
                  <tr class="void-row">
                    <td colspan="6">
                      <form class="void-form" (submit)="$event.preventDefault(); confirmVoid()">
                        <label class="field">
                          {{ 'pos.void.reason' | translate }}
                          <input type="text" minlength="3" maxlength="255" required [value]="reason()" (input)="reason.set($any($event.target).value)" autofocus />
                        </label>
                        <button type="button" class="btn btn-sm" (click)="voiding.set(null)">{{ 'pos.cancel' | translate }}</button>
                        <button type="submit" class="btn btn-sm btn-danger" [disabled]="reason().trim().length < 3 || busy()">{{ 'pos.void.confirm' | translate: { amount: (sale.total | vxMoney: till.currency()) } }}</button>
                      </form>
                    </td>
                  </tr>
                }
              } @empty {
                <tr><td colspan="6" class="muted center">{{ 'pos.journal.empty' | translate }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </pos-dialog>
  `,
  styles: [
    `
      .search { display: flex; align-items: center; gap: 8px; padding: 0 12px; min-height: 44px; border: 1px solid var(--pos-border-strong); border-radius: var(--pos-radius); background: var(--pos-bg); color: var(--pos-muted); }
      .search input { flex: 1; background: transparent; border: 0; outline: none; }
      .search input:focus-visible { box-shadow: none; }
      .muted { color: var(--pos-muted); margin: 0; }
      .center { text-align: center; padding: 24px; }
      .table-wrap { overflow: auto; max-height: 55vh; border: 1px solid var(--pos-border); border-radius: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
      th { position: sticky; top: 0; background: var(--pos-surface-2); text-align: left; font-weight: 600; color: var(--pos-muted); padding: 10px 12px; }
      td { padding: 8px 12px; border-top: 1px solid var(--pos-border); }
      .r { text-align: right; }
      .strong { font-weight: 700; }
      .mono { font-family: ui-monospace, monospace; font-size: 0.85rem; }
      .voided td { color: var(--pos-faint); }
      .voided .strong { text-decoration: line-through; }
      .tag--void { padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--pos-danger) 20%, transparent); color: var(--pos-danger); font-size: 0.75rem; font-weight: 700; }
      .row-actions { white-space: nowrap; text-align: right; }
      .danger:hover { color: var(--pos-danger) !important; }
      .void-row td { background: var(--pos-bg); }
      .void-form { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
      .void-form .field { flex: 1; min-width: 220px; }
    `,
  ],
})
export class JournalDialogComponent {
  protected readonly till = inject(TillStore);
  protected readonly auth = inject(AuthService);
  private readonly documents = inject(DocumentsService);
  private readonly toast = inject(ToastService);
  readonly closed = output<void>();

  protected readonly PrintIcon = Printer;
  protected readonly VoidIcon = Ban;
  protected readonly SearchIcon = Search;

  protected readonly loading = signal(true);
  protected readonly sales = signal<PosSale[]>([]);
  protected readonly query = signal('');
  protected readonly voiding = signal<PosSale | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);

  protected readonly visible = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    if (!q) return this.sales();
    return this.sales().filter(
      (sale) =>
        sale.id.toLocaleLowerCase().startsWith(q) ||
        (sale.customerName ?? '').toLocaleLowerCase().includes(q) ||
        sale.items.some((line) => line.productName.toLocaleLowerCase().includes(q)),
    );
  });

  constructor() {
    this.load();
  }

  protected print(sale: PosSale): void {
    void this.documents.printReceipt(sale);
  }

  protected startVoid(sale: PosSale): void {
    this.reason.set('');
    this.voiding.set(sale);
  }

  protected confirmVoid(): void {
    const sale = this.voiding();
    const reason = this.reason().trim();
    if (!sale || reason.length < 3 || this.busy()) return;
    this.busy.set(true);
    this.till.voidSale(sale, reason).subscribe({
      next: (voided) => {
        this.busy.set(false);
        this.voiding.set(null);
        this.sales.update((list) => list.map((s) => (s.id === voided.id ? voided : s)));
      },
      error: () => this.busy.set(false),
    });
  }

  private load(): void {
    this.till.sales().subscribe({
      next: (sales) => {
        this.sales.set(sales);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(this.till.errorKey(err, 'pos.journal.error'));
      },
    });
  }
}
