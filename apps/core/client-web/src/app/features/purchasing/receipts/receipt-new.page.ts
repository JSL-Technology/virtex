import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';
import { PurchaseOrder, PurchasingService } from '../data/purchasing.service';

const QUANTITY_EPSILON = 0.000001;
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
const todayIso = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

interface ReceiptLineValue {
  lineId: string;
  description: string;
  ordered: number;
  outstanding: number;
  quantity: number | null;
}

/**
 * Recording a delivery against a purchase order (audit H-03).
 *
 * It was a panel inside the order's form. As a document of its own it is what MIGO, NetSuite's
 * *Receive* and Odoo's receipt validation are: choose the order, state what arrived — pre-filled
 * with what is still outstanding, because «everything came» is the common case — where it went and
 * on which day. Saving moves the stock, posts Dr Inventory / Cr GRNI and opens the receipt.
 */
@Component({
  selector: 'app-goods-receipt-new-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, DraftShellComponent, VxDateFieldComponent],
  templateUrl: './receipt-new.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoodsReceiptNewPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly purchasing = inject(PurchasingService);
  private readonly warehousesApi = inject(WarehousesService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  /** `?orderId=` — from the order's «Receive». */
  readonly orderId = input<string>();

  readonly form: FormGroup = this.fb.group({
    orderId: ['', [Validators.required]],
    receivedAt: [todayIso(), [Validators.required]],
    warehouseId: [''],
    notes: ['', [Validators.maxLength(500)]],
    lines: this.fb.array([]),
  });

  readonly orders = signal<PurchaseOrder[]>([]);
  readonly order = signal<PurchaseOrder | null>(null);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  readonly loadingOrder = signal(false);

  readonly hasLines = computed(() => (this.order()?.lines.length ?? 0) > 0);

  protected readonly orderLabel = (order: PurchaseOrder): string =>
    order.supplier?.name ? `${order.number} · ${order.supplier.name}` : order.number;
  protected readonly orderValue = (order: PurchaseOrder): string => order.id;
  protected readonly orderSearchText = (order: PurchaseOrder): string => `${order.number} ${order.supplier?.name ?? ''}`;

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  ngOnInit(): void {
    this.warehousesApi.list().subscribe({
      next: (rows) => this.warehouses.set(rows.filter((warehouse) => warehouse.isActive)),
      error: () => this.warehouses.set([]),
    });
    // The orders goods can still arrive against: sent, or partly received.
    this.purchasing.listOrders(1, 200, null, { receivable: true }).subscribe({
      next: (page) => this.orders.set(page.rows),
      error: () => this.orders.set([]),
    });
    this.form.get('orderId')?.valueChanges.subscribe((id: string) => this.selectOrder(id));
    const preset = this.orderId();
    if (preset) this.form.patchValue({ orderId: preset });
  }

  /** Fill every line with what is still outstanding. */
  receiveAll(): void {
    this.lines.controls.forEach((control) => control.patchValue({ quantity: control.value.outstanding }));
    this.form.markAsDirty();
  }

  save(): void {
    if (!this.validate()) return;
    const raw = this.form.getRawValue();
    const lines = (raw.lines as ReceiptLineValue[])
      .filter((line) => Number(line.quantity) > 0)
      .map((line) => ({ lineId: line.lineId, quantity: round6(Number(line.quantity)) }));
    this.saving.set(true);
    this.purchasing
      .createReceipt({
        orderId: raw.orderId,
        receivedAt: raw.receivedAt,
        warehouseId: raw.warehouseId || undefined,
        notes: String(raw.notes ?? '').trim() || undefined,
        lines,
      })
      .subscribe({
        next: (receipt) => {
          this.saving.set(false);
          this.form.markAsPristine();
          this.tab?.markClean();
          this.notifications.showSuccess('purchasing.receipts.recorded', { number: receipt.number });
          const route = `/purchasing/receipts/${receipt.id}`;
          if (this.tab) this.tab.replaceRoute(route, { title: receipt.number });
          else void this.router.navigateByUrl(this.organization.urlFor(route));
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'purchasing.receipts.save_failed');
        },
      });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/purchasing/receipts'));
  }

  private selectOrder(id: string): void {
    this.lines.clear();
    this.order.set(null);
    if (!id) return;
    this.loadingOrder.set(true);
    this.purchasing.getOrder(id).subscribe({
      next: (order) => {
        this.loadingOrder.set(false);
        this.order.set(order);
        for (const line of order.lines) {
          const outstanding = round6(Number(line.quantity) - Number(line.receivedQuantity ?? 0));
          if (!line.id || outstanding <= QUANTITY_EPSILON) continue;
          this.lines.push(
            this.fb.group({
              lineId: [line.id],
              description: [line.description],
              ordered: [Number(line.quantity)],
              outstanding: [outstanding],
              quantity: [outstanding, [Validators.min(0), Validators.max(outstanding)]],
            }),
          );
        }
      },
      error: (error: unknown) => {
        this.loadingOrder.set(false);
        this.notifications.showHttpError(error, 'purchasing.receipts.order_load_failed');
      },
    });
  }

  private validate(): boolean {
    const lineProblems: DraftProblem[] = [];
    const values = this.lines.getRawValue() as ReceiptLineValue[];
    values.forEach((line) => {
      if (Number(line.quantity) - line.outstanding > QUANTITY_EPSILON) {
        lineProblems.push({ message: 'purchasing.receipts.exceeds_outstanding', params: { description: line.description } });
      }
    });
    if (!values.some((line) => Number(line.quantity) > 0)) {
      lineProblems.push({ message: 'purchasing.receipts.no_quantities' });
    }
    if (this.form.invalid || lineProblems.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, { orderId: 'purchasing.receipts.order', receivedAt: 'purchasing.receipts.date' }),
        ...lineProblems,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }
}
