import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { NotificationService } from '../../../../core/services/notification';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchasingService,
} from '../../../../core/api/purchasing.service';
import { SuppliersService } from '../../../../core/api/suppliers.service';
import { Supplier } from '../../../../core/models/supplier.model';
import { InventoryService } from '../../../../core/api/inventory.service';
import { Product } from '../../../../core/models/product.model';

/**
 * Raising, approving, sending and receiving a purchase order.
 *
 * The screen this belongs to listed four orders invented in the browser and its "New order" button
 * led nowhere — there was no table, no endpoint and no form. What an order needs, and what this
 * carries: a supplier, the lines with the price actually agreed, the lifecycle that takes it from a
 * draft somebody wrote to a commitment the supplier has seen, and the receipt of what arrived,
 * which is what turns the order into an answer to "what is still outstanding".
 *
 * Nothing here posts to the ledger. An order is a commitment, not a transaction: the vendor bill
 * is what debits inventory and credits payables when the goods and the invoice arrive.
 */
@Component({
  selector: 'app-purchase-order-form-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    DraftShellComponent,
    RouterLink,
  ],
  templateUrl: './form.page.html',
  styleUrls: ['./form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PurchaseOrderFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly purchasing = inject(PurchasingService);
  private readonly suppliersApi = inject(SuppliersService);
  private readonly inventory = inject(InventoryService);
  private readonly notifications = inject(NotificationService);

  @Input() id?: string;

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  form!: FormGroup;
  readonly saving = signal(false);
  readonly suppliers = signal<Supplier[]>([]);
  readonly products = signal<Product[]>([]);
  readonly current = signal<PurchaseOrder | null>(null);
  readonly problems = signal<DraftProblem[]>([]);

  readonly isNew = computed(() => !this.current());
  readonly status = computed<PurchaseOrderStatus | null>(() => this.current()?.status ?? null);

  /** Once the supplier has seen it, the terms are not ours alone to change. */
  readonly editable = computed(
    () => this.isNew() || this.status() === 'DRAFT' || this.status() === 'PENDING_APPROVAL',
  );
  readonly canSubmit = computed(() => this.status() === 'DRAFT');
  readonly canApprove = computed(() => this.status() === 'PENDING_APPROVAL');
  readonly canSend = computed(() => this.status() === 'APPROVED');
  readonly canReceive = computed(
    () => this.status() === 'SENT' || this.status() === 'PARTIALLY_RECEIVED',
  );
  readonly canCancel = computed(
    () => this.status() !== null && !['RECEIVED', 'CANCELLED'].includes(this.status()!),
  );

  readonly subtotal = signal(0);
  readonly taxTotal = signal(0);
  readonly total = signal(0);

  /** What the user is entering as received, keyed by order line. */
  readonly receiving = signal(false);
  readonly receiptQuantities = signal<Record<string, number>>({});

  readonly cancelling = signal(false);
  readonly cancellationReason = signal('');

  ngOnInit(): void {
    this.form = this.fb.group({
      supplierId: ['', [Validators.required]],
      orderDate: [todayIso(), [Validators.required]],
      expectedDate: [''],
      notes: [''],
      lines: this.fb.array([]),
    });

    this.suppliersApi.getSuppliers().subscribe({
      next: (data) => this.suppliers.set(data),
      error: () => this.suppliers.set([]),
    });
    this.inventory.getProducts().subscribe({
      next: (data) => this.products.set(data),
      error: () => this.products.set([]),
    });

    if (this.id) {
      this.purchasing.getOrder(this.id).subscribe({
        next: (order) => this.load(order),
        error: () => this.notifications.showError('procurement.order_not_found'),
      });
    } else {
      this.addLine();
    }

    this.form.valueChanges.subscribe(() => this.recomputeTotals());
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  addLine(): void {
    this.lines.push(
      this.fb.group({
        id: [''],
        productId: [''],
        description: ['', [Validators.required]],
        quantity: [1, [Validators.required, Validators.min(0.000001)]],
        receivedQuantity: [0],
        unitPrice: [0, [Validators.required, Validators.min(0)]],
        taxRate: [0, [Validators.min(0), Validators.max(1)]],
        unitOfMeasure: ['UND'],
      }),
    );
  }

  removeLine(index: number): void {
    this.lines.removeAt(index);
    this.recomputeTotals();
  }

  /**
   * Picking a product fills the line from the catalogue.
   *
   * The unit price defaults to the product's **cost**, not its selling price: this is what we pay
   * the supplier, and defaulting to the price we charge our own customers would quietly inflate
   * every purchase order in the system.
   */
  onProductChange(index: number, productId: string): void {
    const product = this.products().find((candidate) => candidate.id === productId);
    if (!product) return;
    const line = this.lines.at(index);
    line.patchValue({
      description: line.value.description || product.name,
      unitPrice: Number(product.cost) || 0,
      taxRate: Number(product.taxRate) || 0,
      unitOfMeasure: product.unitOfMeasure ?? 'UND',
    });
  }

  lineNet(line: { quantity: number; unitPrice: number }): number {
    return round(Number(line.quantity || 0) * Number(line.unitPrice || 0));
  }

  lineTotal(line: { quantity: number; unitPrice: number; taxRate: number }): number {
    const net = this.lineNet(line);
    return round(net + net * Number(line.taxRate || 0));
  }

  /** What is still to arrive on a line: the figure a buyer chases. */
  outstanding(line: { quantity: number; receivedQuantity: number }): number {
    return round(Number(line.quantity || 0) - Number(line.receivedQuantity || 0));
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.problems.set(
        draftProblems(this.form, {
          supplierId: 'purchasing.orders.supplier',
          orderDate: 'purchasing.orders.order_date',
          description: 'purchasing.orders.form.description',
          quantity: 'purchasing.orders.form.quantity',
          unitPrice: 'purchasing.orders.form.unit_price',
        }),
      );
      return;
    }
    this.problems.set([]);

    const raw = this.form.getRawValue();
    const body = {
      supplierId: raw.supplierId,
      orderDate: raw.orderDate,
      expectedDate: raw.expectedDate || undefined,
      notes: raw.notes || undefined,
      lines: (raw.lines as Record<string, string | number>[]).map((line) => ({
        productId: (line['productId'] as string) || undefined,
        description: String(line['description']),
        quantity: Number(line['quantity']),
        unitPrice: Number(line['unitPrice']),
        taxRate: Number(line['taxRate']) || 0,
        unitOfMeasure: String(line['unitOfMeasure'] || 'UND'),
      })),
    };

    this.saving.set(true);
    const request = this.current()
      ? this.purchasing.updateOrder(this.current()!.id, body)
      : this.purchasing.createOrder(body);

    request.subscribe({
      next: (order) => {
        this.saving.set(false);
        this.load(order);
        this.notifications.showSuccess('purchasing.orders.form.saved');
      },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  submit(): void { this.act(this.purchasing.submitOrder(this.current()!.id)); }
  approve(): void { this.act(this.purchasing.approveOrder(this.current()!.id)); }
  send(): void { this.act(this.purchasing.sendOrder(this.current()!.id)); }

  startReceive(): void {
    // Pre-filled with what is still outstanding, because "everything arrived" is the common case.
    const quantities: Record<string, number> = {};
    for (const line of this.current()?.lines ?? []) {
      if (line.id) quantities[line.id] = this.outstanding(line as never);
    }
    this.receiptQuantities.set(quantities);
    this.receiving.set(true);
  }

  setReceiptQuantity(lineId: string, value: string): void {
    this.receiptQuantities.update((current) => ({ ...current, [lineId]: Number(value) || 0 }));
  }

  confirmReceive(): void {
    const lines = Object.entries(this.receiptQuantities())
      .filter(([, quantity]) => quantity > 0)
      .map(([lineId, quantity]) => ({ lineId, quantity }));
    if (lines.length === 0) return;
    this.act(this.purchasing.receiveOrder(this.current()!.id, lines));
    this.receiving.set(false);
  }

  cancelReceive(): void {
    this.receiving.set(false);
  }

  startCancel(): void { this.cancelling.set(true); }
  abortCancel(): void { this.cancelling.set(false); this.cancellationReason.set(''); }

  confirmCancel(): void {
    const reason = this.cancellationReason().trim();
    if (reason.length < 3) return;
    this.act(this.purchasing.cancelOrder(this.current()!.id, reason));
    this.abortCancel();
  }

  cancel(): void {
    void this.router.navigate(['/purchasing/orders']);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private act(request: Observable<PurchaseOrder>): void {
    this.saving.set(true);
    request.subscribe({
      next: (order) => {
        this.saving.set(false);
        this.load(order);
      },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  private fail(error: { error?: { message?: string } }): void {
    this.saving.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'purchasing.orders.form.save_failed',
    );
  }

  private load(order: PurchaseOrder): void {
    this.current.set(order);
    this.lines.clear();
    for (const line of order.lines ?? []) {
      this.lines.push(
        this.fb.group({
          id: [line.id ?? ''],
          productId: [line.productId ?? ''],
          description: [line.description, [Validators.required]],
          quantity: [Number(line.quantity), [Validators.required, Validators.min(0.000001)]],
          receivedQuantity: [Number(line.receivedQuantity ?? 0)],
          unitPrice: [Number(line.unitPrice), [Validators.required, Validators.min(0)]],
          taxRate: [Number(line.taxRate ?? 0), [Validators.min(0), Validators.max(1)]],
          unitOfMeasure: [line.unitOfMeasure ?? 'UND'],
        }),
      );
    }
    this.form.patchValue(
      {
        supplierId: order.supplierId,
        orderDate: order.orderDate,
        expectedDate: order.expectedDate ?? '',
        notes: order.notes ?? '',
      },
      { emitEvent: false },
    );
    if (this.editable()) this.form.enable({ emitEvent: false });
    else this.form.disable({ emitEvent: false });
    this.recomputeTotals();
  }

  private recomputeTotals(): void {
    let subtotal = 0;
    let tax = 0;
    for (const line of this.lines.controls) {
      const net = this.lineNet(line.value);
      subtotal = round(subtotal + net);
      tax = round(tax + net * Number(line.value.taxRate || 0));
    }
    this.subtotal.set(subtotal);
    this.taxTotal.set(tax);
    this.total.set(round(subtotal + tax));
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
