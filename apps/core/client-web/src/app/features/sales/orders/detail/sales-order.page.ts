import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxBadgeComponent, VxTone } from '../../../../shared/components/badge';
import { AuthService } from '../../../../core/services/auth';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { DeliveryNote, SalesOrder, SalesOrderLine, SalesOrdersService } from '../data/sales-orders.service';
import { ORDER_TONE } from '../list/sales-orders.page';

const DELIVERY_TONE: Record<DeliveryNote['status'], VxTone> = { POSTED: 'info', INVOICED: 'ok', VOIDED: 'danger' };

/** Open the conduce's printable page in a new window and print it. */
export function openForPrint(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank', 'noopener=no');
  if (win) win.addEventListener('load', () => win.print(), { once: true });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * One sales order and everything that happened to it: each line ordered / delivered / invoiced,
 * its conduces (printed, voided), and the three things a distributor does next — dispatch a
 * conduce, invoice what left, close what will not.
 */
@Component({
  selector: 'app-sales-order-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, VxBadgeComponent],
  templateUrl: './sales-order.page.html',
  styleUrls: ['../../../../shared/styles/document-list.scss', './sales-order.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SalesOrderPage implements OnInit {
  private readonly orders = inject(SalesOrdersService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly organization = inject(ActiveOrganizationService);

  @Input() id!: string;

  readonly order = signal<SalesOrder | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly delivering = signal(false);
  /** Quantity to deliver per order line, prefilled with what remains. */
  readonly draft = signal<Record<string, number>>({});
  driverName = '';
  vehiclePlate = '';
  receivedBy = '';

  readonly tone = ORDER_TONE;
  readonly deliveryTone = DELIVERY_TONE;
  readonly canAct = computed(() => this.auth.hasPermissions(['invoices:create']));
  readonly canVoid = computed(() => this.auth.hasPermissions(['invoices:void']));
  readonly open = computed(() => {
    const status = this.order()?.status;
    return status === 'CONFIRMED' || status === 'PARTIALLY_DELIVERED' || status === 'DELIVERED';
  });
  readonly pendingDelivery = computed(() => (this.order()?.lines ?? []).some((l) => l.isStocked && this.remaining(l) > 0));
  readonly invoiceable = computed(() => (this.order()?.invoiceable ?? []).length > 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.orders.get(this.id).subscribe({
      next: (order) => {
        this.order.set(order);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.notifications.showHttpError(error, 'sales.orders.load_failed');
      },
    });
  }

  remaining(line: SalesOrderLine): number {
    return Math.max(0, Number(line.quantity) - Number(line.deliveredQuantity));
  }

  startDelivery(): void {
    const draft: Record<string, number> = {};
    for (const line of this.order()?.lines ?? []) if (line.isStocked && this.remaining(line) > 0) draft[line.id] = this.remaining(line);
    this.draft.set(draft);
    this.delivering.set(true);
  }

  setQuantity(lineId: string, value: number): void {
    this.draft.update((d) => ({ ...d, [lineId]: Number(value) || 0 }));
  }

  deliver(): void {
    const lines = Object.entries(this.draft())
      .filter(([, q]) => q > 0)
      .map(([orderLineId, quantity]) => ({ orderLineId, quantity }));
    if (!lines.length) {
      this.notifications.showError('sales.orders.delivery_no_lines');
      return;
    }
    this.busy.set(true);
    this.orders
      .deliver(this.id, { lines, driverName: this.driverName || undefined, vehiclePlate: this.vehiclePlate || undefined, receivedBy: this.receivedBy || undefined })
      .subscribe({
        next: (note) => {
          this.busy.set(false);
          this.delivering.set(false);
          this.notifications.showSuccess('sales.orders.delivered', { number: note.number });
          this.load();
          this.print(note);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.notifications.showHttpError(error, 'sales.orders.deliver_failed');
        },
      });
  }

  async invoice(): Promise<void> {
    const order = this.order();
    if (!order) return;
    const ok = await this.dialog.confirm({
      title: 'sales.orders.invoice_title',
      message: 'sales.orders.invoice_message',
      messageParams: { number: order.orderNumber },
      confirmText: 'sales.orders.invoice',
    });
    if (!ok) return;
    this.busy.set(true);
    this.orders.invoice(this.id).subscribe({
      next: (invoice) => {
        this.busy.set(false);
        this.notifications.showSuccess('sales.orders.invoiced', { number: invoice.fiscalNumber ?? invoice.invoiceNumber ?? '' });
        void this.router.navigateByUrl(this.organization.urlFor(`/invoices/${invoice.id}`));
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'sales.orders.invoice_failed');
      },
    });
  }

  async close(): Promise<void> {
    const ok = await this.dialog.confirm({ title: 'sales.orders.close_title', message: 'sales.orders.close_message', confirmText: 'sales.orders.close' });
    if (!ok) return;
    this.run(this.orders.close(this.id), 'sales.orders.closed');
  }

  async cancel(): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'sales.orders.cancel_title',
      message: 'sales.orders.cancel_message',
      confirmText: 'sales.orders.cancel',
      variant: 'danger',
      minLength: 3,
      tooShort: 'sales.orders.reason_short',
    });
    if (reason) this.run(this.orders.cancel(this.id, reason), 'sales.orders.cancelled');
  }

  async voidDelivery(note: DeliveryNote): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'sales.orders.void_title',
      message: 'sales.orders.void_message',
      messageParams: { number: note.number },
      confirmText: 'sales.orders.void',
      variant: 'danger',
      minLength: 3,
      tooShort: 'sales.orders.reason_short',
    });
    if (reason) this.run(this.orders.voidDelivery(note.id, reason), 'sales.orders.voided');
  }

  print(note: DeliveryNote): void {
    this.orders.printDelivery(note.id).subscribe({
      next: (html) => openForPrint(html),
      error: (error: unknown) => this.notifications.showHttpError(error, 'sales.orders.print_failed'),
    });
  }

  private run(request: ReturnType<SalesOrdersService['close']> | ReturnType<SalesOrdersService['voidDelivery']>, successKey: string): void {
    this.busy.set(true);
    (request as import('rxjs').Observable<unknown>).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess(successKey);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'sales.orders.action_failed');
      },
    });
  }
}
