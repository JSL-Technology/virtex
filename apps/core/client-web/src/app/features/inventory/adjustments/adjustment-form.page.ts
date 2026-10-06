import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
import { InventoryAdjustment, SaveInventoryAdjustment, StockDocumentStatus, StockService } from '../data/stock.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';

export const STOCK_DOCUMENT_TONE: Record<StockDocumentStatus, VxTone> = {
  DRAFT: 'draft',
  POSTED: 'ok',
  CANCELLED: 'neutral',
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * An inventory adjustment: a count, a breakage, a revaluation — written, reviewed, then posted.
 *
 * A line is either COUNTED (what was found on the shelf; the change is taken against the
 * warehouse's balance when posting) or a stated CHANGE (five broken, two samples), and may carry a
 * new unit cost that revalues the product's whole stock. Nothing moves and nothing is booked until
 * «Post»: then the stock moves, the kardex records it and one journal entry books the value.
 */
@Component({
  selector: 'app-inventory-adjustment-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    ...VX_FORM_A11Y,
    ...VX_SELECT,
    DraftShellComponent,
    VxBadgeComponent,
    VxDateFieldComponent,
  ],
  templateUrl: './adjustment-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryAdjustmentFormPage implements OnInit {
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

  /** The document, when editing or viewing one. */
  readonly id = input<string>();
  /** `?productId=` — from the product form's «Adjust stock»: the first line is that product. */
  readonly productId = input<string>();

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  readonly form: FormGroup = this.fb.group({
    date: [todayIso(), [Validators.required]],
    warehouseId: ['', [Validators.required]],
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
    notes: [''],
    lines: this.fb.array([]),
  });

  readonly current = signal<InventoryAdjustment | null>(null);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  /** What the chosen warehouse holds of each line's product, by line index. */
  readonly onHand = signal<Record<number, number | null>>({});

  readonly status = computed(() => this.current()?.status ?? null);
  readonly editable = computed(() => !this.current() || this.status() === 'DRAFT');
  readonly tone = computed<VxTone>(() => STOCK_DOCUMENT_TONE[this.status() ?? 'DRAFT']);
  readonly journalLink = computed(() => {
    const entry = this.current()?.journalEntryId;
    return entry ? this.organization.urlFor(`/accounting/journal-entries/${entry}/edit`) : null;
  });

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
      next: (rows) => {
        this.warehouses.set(rows.filter((warehouse) => warehouse.isActive || warehouse.id === this.form.value.warehouseId));
        // The default warehouse first: most counts happen where most stock is.
        if (!this.form.value.warehouseId && !this.id()) {
          const preferred = rows.find((warehouse) => warehouse.isDefault && warehouse.isActive) ?? rows.find((w) => w.isActive);
          if (preferred) this.form.patchValue({ warehouseId: preferred.id });
        }
      },
      error: () => this.warehouses.set([]),
    });
    this.form
      .get('warehouseId')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshOnHand());

    const id = this.id();
    if (id) {
      this.stock.adjustment(id).subscribe({
        next: (adjustment) => this.load(adjustment),
        error: (error: unknown) => this.notifications.showHttpError(error, 'inventory.adjustments.load_failed'),
      });
    } else {
      this.addLine(this.productId() ?? '');
    }
  }

  addLine(productId = ''): void {
    this.lines.push(this.lineGroup({ productId }));
    if (productId) this.refreshOnHand(this.lines.length - 1);
  }

  removeLine(index: number): void {
    this.lines.removeAt(index);
    const shifted: Record<number, number | null> = {};
    Object.entries(this.onHand()).forEach(([key, value]) => {
      const n = Number(key);
      if (n < index) shifted[n] = value;
      else if (n > index) shifted[n - 1] = value;
    });
    this.onHand.set(shifted);
  }

  onProductChange(index: number): void {
    this.refreshOnHand(index);
  }

  /** The value a line will move, as far as the screen can tell before posting. */
  protected expectedChange(index: number): number | null {
    const line = this.lines.at(index).value as { countedQuantity: number | null; quantityChange: number | null };
    if (line.countedQuantity !== null && line.countedQuantity !== undefined && `${line.countedQuantity}` !== '') {
      const held = this.onHand()[index];
      return held === null || held === undefined ? null : Number(line.countedQuantity) - held;
    }
    return line.quantityChange ? Number(line.quantityChange) : null;
  }

  /** What a posted line actually moved, as the server computed it against the balance. */
  protected postedChange(index: number): number {
    return Number(this.current()?.lines?.[index]?.quantityChange ?? 0);
  }

  protected signClass(value: number): string {
    return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
  }

  save(): void {
    if (!this.validateForm()) return;
    const body = this.body();
    const existing = this.current();
    const creating = !existing;
    this.saving.set(true);
    const request = existing ? this.stock.updateAdjustment(existing.id, body) : this.stock.createAdjustment(body);
    request.subscribe({
      next: (adjustment) => {
        this.saving.set(false);
        this.notifications.showSuccess('inventory.adjustments.saved', { number: adjustment.number });
        if (creating && this.tab) {
          this.tab.replaceRoute(`/inventory/adjustments/${adjustment.id}`, { title: adjustment.number });
          return;
        }
        this.load(adjustment);
      },
      error: (error: unknown) => this.fail(error, 'inventory.adjustments.save_failed'),
    });
  }

  async post(): Promise<void> {
    const adjustment = this.current();
    if (!adjustment) return;
    const confirmed = await this.dialog.confirm({
      title: 'inventory.adjustments.post_title',
      message: 'inventory.adjustments.post_message',
      messageParams: { number: adjustment.number },
      confirmText: 'inventory.adjustments.post',
      variant: 'warning',
    });
    if (!confirmed) return;
    this.saving.set(true);
    this.stock.postAdjustment(adjustment.id).subscribe({
      next: (posted) => {
        this.saving.set(false);
        this.notifications.showSuccess('inventory.adjustments.posted', { number: posted.number });
        this.load(posted);
      },
      error: (error: unknown) => this.fail(error, 'inventory.adjustments.post_failed'),
    });
  }

  async cancelDocument(): Promise<void> {
    const adjustment = this.current();
    if (!adjustment) return;
    const confirmed = await this.dialog.confirm({
      title: 'inventory.adjustments.cancel_title',
      message: 'inventory.adjustments.cancel_message',
      messageParams: { number: adjustment.number },
      confirmText: 'inventory.adjustments.cancel_document',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.saving.set(true);
    this.stock.cancelAdjustment(adjustment.id).subscribe({
      next: (cancelled) => {
        this.saving.set(false);
        this.load(cancelled);
      },
      error: (error: unknown) => this.fail(error, 'inventory.adjustments.save_failed'),
    });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/inventory/adjustments'));
  }

  private validateForm(): boolean {
    const lineProblems: DraftProblem[] = [];
    this.lines.controls.forEach((control, index) => {
      const line = control.value as { productId: string; countedQuantity: unknown; quantityChange: unknown; newUnitCost: unknown };
      const counted = line.countedQuantity !== null && line.countedQuantity !== '';
      const changed = line.quantityChange !== null && line.quantityChange !== '' && Number(line.quantityChange) !== 0;
      const revalued = line.newUnitCost !== null && line.newUnitCost !== '';
      if (!line.productId) lineProblems.push({ message: 'inventory.adjustments.line_needs_product', params: { line: index + 1 } });
      else if (counted && changed) lineProblems.push({ message: 'inventory.adjustments.line_count_or_change', params: { line: index + 1 } });
      else if (!counted && !changed && !revalued) lineProblems.push({ message: 'inventory.adjustments.line_empty', params: { line: index + 1 } });
    });
    const ids = this.lines.controls.map((control) => control.value.productId).filter(Boolean);
    if (new Set(ids).size !== ids.length) lineProblems.push({ message: 'inventory.common.repeated_product' });
    if (this.lines.length === 0) lineProblems.push({ message: 'inventory.common.lines_required' });

    if (this.form.invalid || lineProblems.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, {
          date: 'inventory.common.date',
          warehouseId: 'inventory.common.warehouse',
          reason: 'inventory.adjustments.reason',
        }),
        ...lineProblems,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }

  private body(): SaveInventoryAdjustment {
    const raw = this.form.getRawValue();
    const num = (value: unknown): number | null => (value === null || value === undefined || value === '' ? null : Number(value));
    return {
      date: raw.date,
      warehouseId: raw.warehouseId,
      reason: String(raw.reason).trim(),
      notes: String(raw.notes ?? '').trim() || undefined,
      lines: (raw.lines as Record<string, unknown>[]).map((line) => ({
        productId: String(line['productId']),
        countedQuantity: num(line['countedQuantity']),
        quantityChange: num(line['countedQuantity']) === null ? num(line['quantityChange']) : null,
        unitCost: num(line['unitCost']),
        newUnitCost: num(line['newUnitCost']),
      })),
    };
  }

  private lineGroup(values: Partial<Record<string, unknown>> = {}): FormGroup {
    return this.fb.group({
      productId: [values['productId'] ?? '', [Validators.required]],
      countedQuantity: [values['countedQuantity'] ?? null, [Validators.min(0)]],
      quantityChange: [values['quantityChange'] ?? null],
      unitCost: [values['unitCost'] ?? null, [Validators.min(0)]],
      newUnitCost: [values['newUnitCost'] ?? null, [Validators.min(0)]],
    });
  }

  /** What the warehouse holds of the line's product (or of every line's), from the register. */
  private refreshOnHand(index?: number): void {
    const warehouseId = this.form.value.warehouseId as string;
    const indexes = index === undefined ? this.lines.controls.map((_, i) => i) : [index];
    for (const i of indexes) {
      const productId = this.lines.at(i)?.value.productId as string;
      if (!productId || !warehouseId) {
        this.onHand.update((all) => ({ ...all, [i]: null }));
        continue;
      }
      this.stock
        .onHand({ productId, warehouseId, includeZero: true, limit: 1 })
        .pipe(catchError(() => of(null)))
        .subscribe((result) => {
          this.onHand.update((all) => ({ ...all, [i]: result ? Number(result.items[0]?.quantityOnHand ?? 0) : null }));
        });
    }
  }

  private fail(error: unknown, fallbackKey: string): void {
    this.saving.set(false);
    this.notifications.showHttpError(error, fallbackKey);
  }

  private load(adjustment: InventoryAdjustment): void {
    this.current.set(adjustment);
    this.tab?.setTitle(adjustment.number);
    this.lines.clear({ emitEvent: false });
    const held: Record<number, number | null> = {};
    (adjustment.lines ?? []).forEach((line, index) => {
      this.lines.push(
        this.lineGroup({
          productId: line.productId,
          countedQuantity: line.countedQuantity,
          quantityChange: line.countedQuantity === null ? line.quantityChange || null : null,
          unitCost: line.unitCost,
          newUnitCost: line.newUnitCost,
        }),
        { emitEvent: false },
      );
      held[index] = line.onHand ?? line.quantityBefore ?? null;
    });
    this.onHand.set(held);
    this.form.patchValue(
      {
        date: String(adjustment.date).slice(0, 10),
        warehouseId: adjustment.warehouseId,
        reason: adjustment.reason,
        notes: adjustment.notes ?? '',
      },
      { emitEvent: false },
    );
    if (this.editable()) this.form.enable({ emitEvent: false });
    else this.form.disable({ emitEvent: false });
    this.form.markAsPristine();
    this.tab?.markClean();
  }
}
