import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
} from '@angular/core';
import { LucideAngularModule, Trash2 } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { cartTotals } from '../../../domain/cart';
import { ParkedTicket, TillStore } from '../../../state/till.store';
import { DialogComponent } from './dialog.component';

/** Tickets on hold. Recalling one parks the open ticket in its place, so nothing is lost. */
@Component({
  selector: 'pos-parked-dialog',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslateModule,
    DialogComponent,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pos-dialog [title]="'pos.park.title'" (closed)="closed.emit()">
      <ul class="list">
        @for (ticket of till.parked(); track ticket.id) {
          <li>
            <button type="button" class="ticket" (click)="recall(ticket)">
              <span class="who">{{
                ticket.customer || ('pos.walk_in_customer' | translate)
              }}</span>
              <span class="meta"
                >{{ ticket.parkedAt | vxDate: 'time' }} ·
                {{
                  'pos.park.items' | translate: { count: units(ticket) }
                }}</span
              >
              <span class="amount num">{{
                total(ticket) | vxMoney: till.currency()
              }}</span>
            </button>
            <button
              type="button"
              class="icon-btn"
              (click)="till.discardParked(ticket.id)"
              [attr.aria-label]="'pos.park.discard' | translate"
            >
              <lucide-icon [img]="TrashIcon" size="16" aria-hidden="true" />
            </button>
          </li>
        } @empty {
          <li class="muted">{{ 'pos.park.empty' | translate }}</li>
        }
      </ul>
    </pos-dialog>
  `,
  styles: [
    `
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      li {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .ticket {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr auto;
        text-align: left;
        gap: 2px 12px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid var(--pos-border-strong);
        background: var(--pos-surface-2);
      }
      .ticket:hover {
        border-color: var(--pos-primary);
      }
      .who {
        font-weight: 600;
      }
      .meta {
        grid-row: 2;
        color: var(--pos-muted);
        font-size: 0.82rem;
      }
      .amount {
        grid-row: 1 / span 2;
        grid-column: 2;
        align-self: center;
        font-weight: 700;
        font-size: 1.05rem;
      }
      .muted {
        color: var(--pos-muted);
      }
    `,
  ],
})
export class ParkedDialogComponent {
  protected readonly till = inject(TillStore);
  readonly closed = output<void>();
  protected readonly TrashIcon = Trash2;

  protected total(ticket: ParkedTicket): number {
    return cartTotals(ticket.lines).total;
  }

  protected units(ticket: ParkedTicket): number {
    return cartTotals(ticket.lines).units;
  }

  protected recall(ticket: ParkedTicket): void {
    this.till.recall(ticket.id);
    this.closed.emit();
  }
}
