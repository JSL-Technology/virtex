import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators, AbstractControl } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, catchError, map, of } from 'rxjs';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { InventoryService } from '../../../core/api/inventory.service';
import { Product } from '../../../core/models/product.model';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { SaveStockTransfer, StockService, StockTransfer } from '../data/stock.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';
import { STOCK_DOCUMENT_TONE } from '../adjustments/adjustment-form.page';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Origin and destination must differ: a transfer to the same place moves nothing. */
function distinctWarehouses(group: AbstractControl): ValidationErrors | null {
  const from = group.get('fromWarehouseId')?.value;
  const to = group.get('toWarehouseId')?.value;
  return from && to && from === to ? { sameWarehouse: true } : null;
}

/**
 * A transfer between warehouses: drafted with what goes where, then posted.
 *
 * Shows what the origin holds of each product while drafting, so a transfer the origin cannot
 * cover is visible before posting — where the server refuses it anyway, line by line.
 */
@Component({
  selector: 'app-stock-transfer-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    ...VX_SELECT,
    DraftShellComponent,
    VxBadgeComponent,
    VxDateFieldComponent,
  ],
  templateUrl: './transfer-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockTransferFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly stock = inject(StockService);
  private readonly products = inject(InventoryService);
  private readonly warehousesApi = inject(WarehousesService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input<string>();

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  readonly form: FormGroup = this.fb.group(
    {
      date: [todayIso(), [Validators.required]],
      fromWarehouseId: ['', [Validators.required]],
      toWarehouseId: ['', [Validators.required]],
      notes: [''],
      lines: this.fb.array([]),
    },
    { validators: distinctWarehouses },
  );

  readonly current = signal<StockTransfer | null>(null);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  readonly available = signal<Record<number, number | null>>({});

  readonly status = computed(() => this.current()?.status ?? null);
  readonly editable = computed(() => !this.current() || this.status() === 'DRAFT');
  readonly tone = computed<VxTone>(() => STOCK_DOCUMENT_TONE[this.status() ?? 'DRAFT']);

  protected readonly searchProducts = (query: string, limit: number): Observable<Product[]> =>
    this.products.searchProducts(query, limit).pipe(map((rows) => rows.filter((product) => product.kind !== 'SERVICE')));
  protected readonly resolveProduct = (id: string): Observable<Product> => this.products.getProductById(id);
  protected readonly productName = (product: Product): string => (product.sku ? `${product.sku} · ${product.name}` : product.name);
  protected readonly productValue = (product: Product): string => product.id;

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  ngOnInit(): void {
    this.warehousesApi.list().subscribe({
      next: (rows) => this.warehouses.set(rows.filter((warehouse) => warehouse.isActive)),
      error: () => this.warehouses.set([]),
    });
    this.form
      .get('fromWarehouseId')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshAvailable());

    const id = this.id();
    if (id) {
      this.stock.transfer(id).subscribe({
        next: (transfer) => this.load(transfer),
        error: (error: unknown) => this.notifications.showHttpError(error, 'inventory.transfers.load_failed'),
      });
    } else {
      this.addLine();
    }
  }

  addLine(): void {
    this.lines.push(this.lineGroup());
  }

  removeLine(index: number): void {
    this.lines.removeAt(index);
    this.refreshAvailable();
  }

  onProductChange(index: number): void {
    this.refreshAvailable(index);
  }

  protected short(index: number): boolean {
    const held = this.available()[index];
    const quantity = Number(this.lines.at(index)?.value.quantity ?? 0);
    return held !== null && held !== undefined && quantity > held;
  }

  save(): void {
    if (!this.validateForm()) return;
    const body = this.body();
    const existing = this.current();
    const creating = !existing;
    this.saving.set(true);
    const request = existing ? this.stock.updateTransfer(existing.id, body) : this.stock.createTransfer(body);
    request.subscribe({
      next: (transfer) => {
        this.saving.set(false);
        this.notifications.showSuccess('inventory.transfers.saved', { number: transfer.number });
        if (creating && this.tab) {
          this.tab.replaceRoute(`/inventory/transfers/${transfer.id}`, { title: transfer.number });
          return;
        }
        this.load(transfer);
      },
      error: (error: unknown) => this.fail(error, 'inventory.transfers.save_failed'),
    });
  }

  async post(): Promise<void> {
    const transfer = this.current();
    if (!transfer) return;
    const confirmed = await this.dialog.confirm({
      title: 'inventory.transfers.post_title',
      message: 'inventory.transfers.post_message',
      messageParams: { number: transfer.number, from: transfer.fromWarehouseName, to: transfer.toWarehouseName },
      confirmText: 'inventory.transfers.post',
    });
    if (!confirmed) return;
    this.saving.set(true);
    this.stock.postTransfer(transfer.id).subscribe({
      next: (posted) => {
        this.saving.set(false);
        this.notifications.showSuccess('inventory.transfers.posted', { number: posted.number });
        this.load(posted);
      },
      error: (error: unknown) => this.fail(error, 'inventory.transfers.post_failed'),
    });
  }

  async cancelDocument(): Promise<void> {
    const transfer = this.current();
    if (!transfer) return;
    const confirmed = await this.dialog.confirm({
      title: 'inventory.transfers.cancel_title',
      message: 'inventory.transfers.cancel_message',
      messageParams: { number: transfer.number },
      confirmText: 'inventory.transfers.cancel_document',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.saving.set(true);
    this.stock.cancelTransfer(transfer.id).subscribe({
      next: (cancelled) => {
        this.saving.set(false);
        this.load(cancelled);
      },
      error: (error: unknown) => this.fail(error, 'inventory.transfers.save_failed'),
    });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/inventory/transfers'));
  }

  private validateForm(): boolean {
    const lineProblems: DraftProblem[] = [];
    this.lines.controls.forEach((control, index) => {
      const line = control.value as { productId: string; quantity: unknown };
      if (!line.productId) lineProblems.push({ message: 'inventory.adjustments.line_needs_product', params: { line: index + 1 } });
      if (!(Number(line.quantity) > 0)) lineProblems.push({ message: 'inventory.transfers.line_needs_quantity', params: { line: index + 1 } });
    });
    const ids = this.lines.controls.map((control) => control.value.productId).filter(Boolean);
    if (new Set(ids).size !== ids.length) lineProblems.push({ message: 'inventory.common.repeated_product' });
    if (this.lines.length === 0) lineProblems.push({ message: 'inventory.common.lines_required' });
    if (this.form.hasError('sameWarehouse')) lineProblems.push({ message: 'inventory.transfers.same_warehouse' });

    if (this.form.invalid || lineProblems.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, {
          date: 'inventory.common.date',
          fromWarehouseId: 'inventory.transfers.from',
          toWarehouseId: 'inventory.transfers.to',
        }),
        ...lineProblems,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }

  private body(): SaveStockTransfer {
    const raw = this.form.getRawValue();
    return {
      date: raw.date,
      fromWarehouseId: raw.fromWarehouseId,
      toWarehouseId: raw.toWarehouseId,
      notes: String(raw.notes ?? '').trim() || undefined,
      lines: (raw.lines as Record<string, unknown>[]).map((line) => ({
        productId: String(line['productId']),
        quantity: Number(line['quantity']),
      })),
    };
  }

  private lineGroup(values: { productId?: string; quantity?: number } = {}): FormGroup {
    return this.fb.group({
      productId: [values.productId ?? '', [Validators.required]],
      quantity: [values.quantity ?? null, [Validators.required, Validators.min(0.000001)]],
    });
  }

  private refreshAvailable(index?: number): void {
    const warehouseId = this.form.value.fromWarehouseId as string;
    const indexes = index === undefined ? this.lines.controls.map((_, i) => i) : [index];
    if (index === undefined) this.available.set({});
    for (const i of indexes) {
      const productId = this.lines.at(i)?.value.productId as string;
      if (!productId || !warehouseId) continue;
      this.stock
        .onHand({ productId, warehouseId, includeZero: true, limit: 1 })
        .pipe(catchError(() => of(null)))
        .subscribe((result) => {
          this.available.update((all) => ({ ...all, [i]: result ? Number(result.items[0]?.quantityOnHand ?? 0) : null }));
        });
    }
  }

  private fail(error: unknown, fallbackKey: string): void {
    this.saving.set(false);
    this.notifications.showHttpError(error, fallbackKey);
  }

  private load(transfer: StockTransfer): void {
    this.current.set(transfer);
    this.tab?.setTitle(transfer.number);
    this.lines.clear({ emitEvent: false });
    const held: Record<number, number | null> = {};
    (transfer.lines ?? []).forEach((line, index) => {
      this.lines.push(this.lineGroup({ productId: line.productId, quantity: Number(line.quantity) }), { emitEvent: false });
      held[index] = line.available ?? null;
    });
    this.available.set(held);
    this.form.patchValue(
      {
        date: String(transfer.date).slice(0, 10),
        fromWarehouseId: transfer.fromWarehouseId,
        toWarehouseId: transfer.toWarehouseId,
        notes: transfer.notes ?? '',
      },
      { emitEvent: false },
    );
    if (this.editable()) this.form.enable({ emitEvent: false });
    else this.form.disable({ emitEvent: false });
    this.form.markAsPristine();
    this.tab?.markClean();
  }
}
