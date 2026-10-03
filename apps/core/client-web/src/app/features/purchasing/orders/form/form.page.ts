import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { FORMAT_PIPES, LocaleStore } from '@virteex/shared/ui-i18n';
import { CurrenciesService } from '../../../../core/api/currencies.service';
import { NotificationService } from '../../../../core/services/notification';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchasingService,
  PurchaseOrderReceipt,
} from '../../../../core/api/purchasing.service';
import { SuppliersService } from '../../../../core/api/suppliers.service';
import { Supplier } from '../../../../core/models/supplier.model';
import { InventoryService } from '../../../../core/api/inventory.service';
import { Product } from '../../../../core/models/product.model';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxBadgeComponent, VxTone } from '../../../../shared/components/badge';
import { VxLifecycleStripComponent } from '../../../../shared/components/lifecycle-strip';
import { VxAmountComponent } from '../../../../shared/components/amount';
import { VxDateFieldComponent, dateOrder } from '../../../../shared/components/date';
import { VX_SELECT } from '../../../../shared/components/select';

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
    ...VX_FORM_A11Y, VxBadgeComponent, VxLifecycleStripComponent, VxAmountComponent, VxDateFieldComponent, ...VX_SELECT],
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
  private readonly locale = inject(LocaleStore);
  private readonly currencies = inject(CurrenciesService);
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  @Input() id?: string;

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  form!: FormGroup;
  readonly saving = signal(false);
  /** Busca proveedores en el servidor. Campo de función: `vx-select` lo recibe como entrada. */
  protected readonly searchSuppliers = (query: string, limit: number): Observable<Supplier[]> =>
    this.suppliersApi.searchSuppliers(query, limit);

  /** Nombra el proveedor que un id designa: un pedido guardado se reabre con el suyo puesto. */
  protected readonly resolveSupplier = (id: string): Observable<Supplier> =>
    this.suppliersApi.getSupplierById(id);

  protected readonly supplierName = (supplier: Supplier): string => supplier.name;
  protected readonly supplierId = (supplier: Supplier): string => supplier.id;
  protected readonly supplierTaxId = (supplier: Supplier): string | null => supplier.taxId ?? null;

  /** Busca productos en el servidor: el catálogo ya no se descarga entero por cada línea. */
  protected readonly searchProducts = (query: string, limit: number): Observable<Product[]> =>
    this.inventory
      .searchProducts(query, limit)
      .pipe(tap((products) => products.forEach((product) => this.rememberProduct(product))));

  /** Nombra el producto que un id designa: un pedido guardado se reabre con sus líneas puestas. */
  protected readonly resolveProduct = (id: string): Observable<Product> =>
    this.inventory.getProductById(id).pipe(tap((product) => this.rememberProduct(product)));

  protected readonly productName = (product: Product): string => product.name;
  protected readonly productId = (product: Product): string => product.id;
  protected readonly productSku = (product: Product): string | null =>
    (product as { sku?: string }).sku ?? null;

  /** Los productos que este formulario ha visto, por id, para no volver a pedirlos. */
  private readonly productsById = new Map<string, Product>();

  private rememberProduct(product: Product): void {
    this.productsById.set(product.id, product);
  }

  readonly current = signal<PurchaseOrder | null>(null);
  readonly problems = signal<DraftProblem[]>([]);

  readonly isNew = computed(() => !this.current());
  readonly status = computed<PurchaseOrderStatus | null>(() => this.current()?.status ?? null);

  /**
   * El tono del estado en la cabecera del documento.
   *
   * La insignia de esta pantalla no tenía ninguno: era `.status-badge` a secas, gris, con el
   * mismo aspecto para un pedido recibido que para uno cancelado. En la LISTA sí se distinguían,
   * porque la lista tenía su propia tabla — el mismo concepto mantenido dos veces y solo una de
   * ellas terminada.
   */
  readonly statusTone = computed<VxTone>(() => {
    switch (this.status()) {
      case 'RECEIVED':
        return 'ok';
      case 'APPROVED':
      case 'SENT':
        return 'info';
      case 'PENDING_APPROVAL':
      case 'PARTIALLY_RECEIVED':
        return 'warning';
      case 'CANCELLED':
        return 'danger';
      default:
        return 'draft';
    }
  });

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
  /**
   * Whether a supplier invoice can still be raised from this order: it has been sent and some line
   * is not fully billed. Opens the vendor-bill form pre-filled and tied to the order lines, which is
   * what makes the bill clear "goods received not invoiced" instead of receiving the goods again.
   */
  readonly canBill = computed(() => {
    const order = this.current();
    if (!order || !['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(order.status)) return false;
    return (order.lines ?? []).some(
      (line) => Number(line.quantity) - Number(line.billedQuantity ?? 0) > 0.000001,
    );
  });

  /** Deliveries recorded against the order, with the entry each one posted. */
  readonly receipts = signal<PurchaseOrderReceipt[]>([]);

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

  /**
   * The order's currency (QA A-12): it starts on the books currency — the API already defaulted to
   * it, but the screen offered no choice and showed amounts in the USD fallback. A foreign
   * supplier's order can be raised in its own currency.
   */
  readonly currencyCodes = signal<string[]>([]);
  readonly currencyOptions = computed(() => {
    const codes = new Set([this.locale.currency(), ...this.currencyCodes()]);
    const own = this.current()?.currencyCode;
    if (own) codes.add(own);
    return [...codes];
  });
  readonly currencyCode = signal<string | null>(null);

  readonly rejecting = signal(false);
  readonly rejectionReason = signal('');

  ngOnInit(): void {
    this.form = this.fb.group({
      supplierId: ['', [Validators.required]],
      currencyCode: [this.locale.currency(), [Validators.required]],
      orderDate: [todayIso(), [Validators.required]],
      expectedDate: [''],
      notes: [''],
      lines: this.fb.array([]),
    },
      {
        //  El orden de las dos fechas, que no comprobaba nadie: un rango invertido se
        //  guardaba tal cual. El error cae en el grupo Y en el control tardío, para que
        //  el resumen del armazón de borrador pueda nombrar un campo.
        validators: dateOrder('orderDate', 'expectedDate'),
      },
    );

    this.currencies.getCurrencies().subscribe({
      next: (all) => this.currencyCodes.set(all.map((currency) => currency.code)),
      error: () => this.currencyCodes.set([]),
    });
    this.currencyCode.set(this.locale.currency());
    this.form.get('currencyCode')?.valueChanges.subscribe((code: string) => this.currencyCode.set(code || null));

    if (this.id) {
      this.purchasing.getOrder(this.id).subscribe({
        next: (order) => {
          this.load(order);
          this.loadReceipts(order.id);
        },
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
  onProductChange(index: number, product: Product | null): void {
    //  El producto llega del campo, no de una lista cargada de antemano. Limpiarlo devuelve la
    //  línea a texto libre y deja intacto lo que el comprador ya había escrito.
    if (!product) return;
    this.rememberProduct(product);
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
      currencyCode: raw.currencyCode || undefined,
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

    const creating = !this.current();

    request.subscribe({
      next: (order) => {
        this.saving.set(false);
        this.notifications.showSuccess('purchasing.orders.form.saved');

        //  Ya no es «Nueva orden de compra»: la ventana y la URL pasan a la orden, que se vuelve a
        //  montar sobre su propia ruta. Ver `TabContext.replaceRoute`.
        if (creating && this.tab) {
          this.tab.replaceRoute(`/purchasing/orders/${order.id}/edit`, { title: order.number });
          return;
        }

        this.load(order);
      },
      error: (error: unknown) => this.fail(error),
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
    const order = this.current();
    if (!order) return;
    const lines = Object.entries(this.receiptQuantities())
      .filter(([, quantity]) => quantity > 0)
      .map(([lineId, quantity]) => ({ lineId, quantity }));
    if (lines.length === 0) {
      this.notifications.showError('procurement.receipt_has_no_quantities');
      return;
    }
    //  Se comprueba antes de enviar: recibir más de lo pendiente es lo único que el servidor
    //  rechazaría, y decirlo aquí señala la línea exacta.
    for (const { lineId, quantity } of lines) {
      const line = order.lines.find((candidate) => candidate.id === lineId);
      if (line && quantity - this.outstanding(line as never) > 0.000001) {
        this.notifications.showError('purchasing.orders.form.receipt_exceeds_outstanding', {
          description: line.description,
        });
        return;
      }
    }
    this.saving.set(true);
    this.purchasing.receiveOrder(order.id, lines).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.receiving.set(false);
        this.load(updated);
        this.loadReceipts(updated.id);
        this.notifications.showSuccess('purchasing.orders.form.receipt_recorded');
      },
      error: (error) => this.fail(error),
    });
  }

  /** Open a supplier invoice for what this order still has to bill. */
  createBill(): void {
    const order = this.current();
    if (!order) return;
    void this.router.navigate(['/accounts-payable/new'], { queryParams: { purchaseOrderId: order.id } });
  }

  private loadReceipts(orderId: string): void {
    this.purchasing.orderReceipts(orderId).subscribe({
      next: (receipts) => this.receipts.set(receipts),
      error: () => this.receipts.set([]),
    });
  }

  cancelReceive(): void {
    this.receiving.set(false);
  }

  startCancel(): void { this.cancelling.set(true); }
  abortCancel(): void { this.cancelling.set(false); this.cancellationReason.set(''); }

  startReject(): void { this.rejecting.set(true); }
  abortReject(): void { this.rejecting.set(false); this.rejectionReason.set(''); }

  /** Back to draft with the reason, so the requester knows what to fix before resubmitting. */
  confirmReject(): void {
    const reason = this.rejectionReason().trim();
    if (reason.length < 3) return;
    this.act(this.purchasing.rejectOrder(this.current()!.id, reason));
    this.abortReject();
  }

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
      error: (error: unknown) => this.fail(error),
    });
  }

  private fail(error: unknown): void {
    this.saving.set(false);
    //  El motivo del servidor —cantidad mayor que la pedida, orden que no se puede aprobar por
    //  quien la creó, cuentas sin configurar— y no un «No se pudo guardar» genérico.
    this.notifications.showHttpError(error, 'purchasing.orders.form.save_failed');
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
        currencyCode: order.currencyCode,
        orderDate: order.orderDate,
        expectedDate: order.expectedDate ?? '',
        notes: order.notes ?? '',
      },
      { emitEvent: false },
    );
    this.currencyCode.set(order.currencyCode);
    if (this.editable()) this.form.enable({ emitEvent: false });
    else this.form.disable({ emitEvent: false });

    //  Lo que hay en pantalla es lo que hay en el servidor. Sin esto el encabezado seguía
    //  anunciando «Sin guardar» encima del aviso de «Guardado». Ver la nota en el formulario de
    //  empleado, donde se documenta por qué un indicador que miente es peor que ninguno.
    this.form.markAsPristine();
    this.tab?.markClean();

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
