import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, CheckCircle2, Printer } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { DocumentsService } from '../../../core/documents.service';
import { PosSale } from '../../../core/pos-api.service';
import { TillStore } from '../../../state/till.store';
import { DialogComponent } from './dialog.component';

/** The sale is in: the change to hand back, in large figures, and the ticket. Enter starts the next sale. */
@Component({
  selector: 'pos-receipt-dialog',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslateModule,
    DialogComponent,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pos-dialog [title]="'pos.pay.done'" (closed)="next.emit()">
      <div class="done" data-testid="pos-sale-done">
        <lucide-icon [img]="DoneIcon" size="56" aria-hidden="true" />
        @if (sale().changeDue > 0) {
          <p class="change-label">{{ 'pos.pay.change' | translate }}</p>
          <p class="change num">
            {{ sale().changeDue | vxMoney: till.currency() }}
          </p>
        }
      </div>
      <dl class="kv">
        <div>
          <dt>{{ 'pos.ticket.number_label' | translate }}</dt>
          <dd>{{ sale().id.slice(0, 8).toUpperCase() }}</dd>
        </div>
        <div>
          <dt>{{ 'pos.total' | translate }}</dt>
          <dd>{{ sale().total | vxMoney: till.currency() }}</dd>
        </div>
        @for (payment of sale().payments; track $index) {
          <div>
            <dt>{{ 'pos.pay.method.' + payment.method | translate }}</dt>
            <dd>{{ payment.amount | vxMoney: till.currency() }}</dd>
          </div>
        }
      </dl>
      <ng-container dialog-actions>
        <button type="button" class="btn" (click)="print()">
          <lucide-icon [img]="PrintIcon" size="16" aria-hidden="true" />
          {{ 'pos.ticket.print' | translate }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          cdkFocusInitial
          (click)="next.emit()"
          data-testid="pos-new-sale"
        >
          {{ 'pos.pay.new_sale' | translate }}
        </button>
      </ng-container>
    </pos-dialog>
  `,
  styles: [
    `
      .done {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 8px 0 4px;
        color: var(--pos-success);
      }
      .change-label {
        margin: 8px 0 0;
        color: var(--pos-muted);
      }
      .change {
        margin: 0;
        font-size: 2.6rem;
        font-weight: 800;
        color: var(--pos-text);
      }
    `,
  ],
})
export class ReceiptDialogComponent {
  protected readonly till = inject(TillStore);
  private readonly documents = inject(DocumentsService);
  readonly sale = input.required<PosSale>();
  readonly next = output<void>();

  protected readonly DoneIcon = CheckCircle2;
  protected readonly PrintIcon = Printer;

  protected print(): void {
    void this.documents.printReceipt(this.sale());
  }
}
