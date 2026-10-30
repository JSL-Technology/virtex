import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Plus, Trash2, ArrowDownRight, ArrowUpRight, AlertTriangle, Undo2, CheckCircle2 } from 'lucide-angular';

import { Observable, catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, FormatService, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems, lineMessage } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { VxFieldErrorComponent } from '../../../shared/components/field-error';
import { DraftAutosave } from '../../../shared/forms/draft-autosave';
import { InventoryService } from '../../../core/api/inventory.service';
import { Product } from '../../../core/models/product.model';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import {
  AdjustmentDateReadiness,
  BalanceChangeDecision,
  BalanceConflict,
  InventoryAdjustment,
  SaveInventoryAdjustment,
  StockDocumentStatus,
  StockService,
} from '../data/stock.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';

export const STOCK_DOCUMENT_TONE: Record<StockDocumentStatus, VxTone> = {
  DRAFT: 'draft',
  POSTED: 'ok',
  CANCELLED: 'neutral',
};

/** Reasons people write most, offered as suggestions so the list reads the same across documents. */
export const ADJUSTMENT_REASON_KEYS = [
  'inventory.adjustments.reasons.physical_count',
  'inventory.adjustments.reasons.cycle_count',
  'inventory.adjustments.reasons.damage',
  'inventory.adjustments.reasons.theft',
  'inventory.adjustments.reasons.expiry',
  'inventory.adjustments.reasons.samples',
  'inventory.adjustments.reasons.internal_use',
  'inventory.adjustments.reasons.data_entry_error',
  'inventory.adjustments.reasons.cost_revaluation',
] as const;

/** What the screen knows about a line's product: enough to show the unit and estimate the value. */
interface LineProduct {
  sku: string | null;
  name: string;
  unitOfMeasure: string | null;
  cost: number;
  /** Held across every warehouse: what a new unit cost revalues. */
  stock: number;
  active: boolean;
}

interface LineFigures {
  /** The signed change in units, as the screen can tell before posting. Null when unknown. */
  difference: number | null;
  /** Its value, estimated: a surplus at the stated cost or average, a loss at average. */
  quantityValue: number;
  /** What a new unit cost adds to (or takes from) the whole stock. */
  revaluationValue: number;
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * An inventory adjustment: a count, a breakage, a revaluation — written, reviewed, posted, and if
 * need be reversed.
 *
 * ## What the screen tells before anything is posted
 *
 * The difference each line will move and what it is worth, line by line and in total — split into
 * shortfall, surplus and revaluation as the journal entry will book them — whether the date can be
 * posted to (the period, as soon as the date is chosen), and whether the accounts the entry needs
 * are configured. The confirmation repeats the impact; nothing is a surprise after «Post».
 *
 * ## What it refuses to lose
 *
 * The draft is kept in the browser while it is being typed (`DraftAutosave`) and offered back after
 * a reload; «Cancel» with changes asks first, as closing the tab does.
 */
@Component({
  selector: 'app-inventory-adjustment-form',
  standalone: true,
  imports: [VxNumberInputDirective, 
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
    VxFieldErrorComponent,
  ],
  templateUrl: './adjustment-form.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss', './adjustment-form.page.scss'],
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
  private readonly auth = inject(AuthService);
  private readonly format = inject(FormatService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  /** The document, when editing or viewing one. */
  readonly id = input<string>();
  /** `?productId=` — from the product form's «Adjust stock»: the first line is that product. */
  readonly productId = input<string>();

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;
  protected readonly DownIcon = ArrowDownRight;
  protected readonly UpIcon = ArrowUpRight;
  protected readonly WarnIcon = AlertTriangle;
  protected readonly ReverseIcon = Undo2;
  protected readonly OkIcon = CheckCircle2;
  protected readonly reasonKeys = ADJUSTMENT_REASON_KEYS;

  readonly form: FormGroup = this.fb.group({
    date: [this.today(), [Validators.required]],
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
  /** The product of each line, by line index. */
  readonly lineProducts = signal<Record<number, LineProduct | null>>({});
  /** Whether the chosen date can be posted to, checked as soon as it is chosen. */
  readonly dateReadiness = signal<AdjustmentDateReadiness | null>(null);
  /** Lines whose balance moved since the count, when posting was refused for it. */
  readonly conflicts = signal<BalanceConflict[] | null>(null);
  /** A copy of unsaved work found in this browser, waiting for the person to keep or drop it. */
  readonly recovered = signal<{ savedAt: number } | null>(null);
  /** Bumped on every form change, so the computed figures below re-read the form. */
  private readonly revision = signal(0);

  readonly status = computed(() => this.current()?.status ?? null);
  readonly canAdjust = computed(() => this.auth.hasPermissions(['inventory:adjust']));
  /** A draft the person may change. Posted, cancelled or without permission: read only. */
  readonly editable = computed(() => this.canAdjust() && (!this.current() || this.status() === 'DRAFT'));
  readonly tone = computed<VxTone>(() => STOCK_DOCUMENT_TONE[this.status() ?? 'DRAFT']);
  readonly journalLink = computed(() => {
    const entry = this.current()?.journalEntryId;
    return entry ? this.organization.urlFor(`/accounting/journal-entries/${entry}/edit`) : null;
  });
  readonly reversesLink = computed(() => {
    const id = this.current()?.reversesAdjustmentId;
    return id ? this.organization.urlFor(`/inventory/adjustments/${id}`) : null;
  });
  readonly reversedByLink = computed(() => {
    const id = this.current()?.reversedByAdjustmentId;
    return id ? this.organization.urlFor(`/inventory/adjustments/${id}`) : null;
  });
  readonly canReverse = computed(
    () =>
      this.canAdjust() &&
      this.status() === 'POSTED' &&
      !this.current()?.reversedByAdjustmentId &&
      !this.current()?.reversesAdjustmentId,
  );
  /** The warehouse's name, from the document when the list of warehouses is not readable. */
  readonly warehouseName = computed(() => {
    const id = this.current()?.warehouseId;
    return this.warehouses().find((warehouse) => warehouse.id === id)?.name ?? this.current()?.warehouseName ?? null;
  });
  readonly settingsLink = '#settings/default-accounts/inventory';

  /** Line by line, what the posting will move — or, once posted, what it moved. */
  readonly figures = computed<LineFigures[]>(() => {
    this.revision();
    const posted = this.status() === 'POSTED';
    return this.lines.controls.map((control, index) => {
      if (posted) {
        const line = this.current()?.lines?.[index];
        return {
          difference: Number(line?.quantityChange ?? 0),
          quantityValue: Number(line?.quantityValue ?? line?.valueChange ?? 0),
          revaluationValue: Number(line?.revaluationValue ?? 0),
        };
      }
      return this.estimate(index, control.value);
    });
  });

  /** The document's impact, as the entry will book it: never netted. */
  readonly impact = computed(() => {
    const figures = this.figures();
    const sum = (pick: (figure: LineFigures) => number) => round2(figures.reduce((total, figure) => total + pick(figure), 0));
    return {
      lines: figures.filter((figure) => (figure.difference ?? 0) !== 0 || figure.revaluationValue !== 0).length,
      unitsIn: figures.reduce((total, figure) => total + Math.max(figure.difference ?? 0, 0), 0),
      unitsOut: figures.reduce((total, figure) => total + Math.min(figure.difference ?? 0, 0), 0),
      shortfall: sum((figure) => Math.min(figure.quantityValue, 0)),
      surplus: sum((figure) => Math.max(figure.quantityValue, 0)),
      revaluation: sum((figure) => figure.revaluationValue),
      net: sum((figure) => figure.quantityValue + figure.revaluationValue),
      unknown: figures.some((figure) => figure.difference === null),
    };
  });

  private autosave: DraftAutosave<Record<string, unknown>> | null = null;

  protected readonly searchProducts = (query: string, limit: number): Observable<Product[]> =>
    this.products.searchProducts(query, limit).pipe(map((rows) => rows.filter((product) => product.kind !== 'SERVICE')));
  protected readonly resolveProduct = (id: string): Observable<Product> => this.products.getProductById(id);
  protected readonly productName = (product: Product): string => {
    const unit = product.unitOfMeasure ? ` (${product.unitOfMeasure})` : '';
    return product.sku ? `${product.sku} · ${product.name}${unit}` : `${product.name}${unit}`;
  };
  protected readonly productValue = (product: Product): string => product.id;

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  ngOnInit(): void {
    this.warehousesApi.list().subscribe({
      next: (rows) => {
        this.warehouses.set(rows.filter((warehouse) => warehouse.isActive || warehouse.id === this.form.value.warehouseId));
        if (!this.form.value.warehouseId && !this.id()) {
          // The default warehouse first: most counts happen where most stock is — unless the
          // adjustment was opened from a product, which goes where that product is held.
          const preferred = rows.find((warehouse) => warehouse.isDefault && warehouse.isActive) ?? rows.find((w) => w.isActive);
          if (preferred) this.form.patchValue({ warehouseId: preferred.id });
          if (this.productId()) this.placeAtProductWarehouse(this.productId()!);
        }
      },
      // Someone who may read adjustments but not warehouses still sees the document's own name.
      error: () => this.warehouses.set([]),
    });
    this.form
      .get('warehouseId')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshOnHand());
    this.form
      .get('date')
      ?.valueChanges.pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((date: string) => (date ? this.stock.adjustmentDateReadiness(date).pipe(catchError(() => of(null))) : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((readiness) => this.dateReadiness.set(readiness));
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.revision.update((n) => n + 1);
      // The summary follows the form: a fixed problem leaves it as soon as it is fixed.
      if (this.problems().length) this.problems.set(this.collectProblems());
      if (this.form.dirty && this.editable()) this.autosave?.save(value);
    });

    this.tab?.registerSaveHandler(() => this.saveAsync());

    const id = this.id();
    this.autosave = new DraftAutosave(`inventory-adjustment.${this.organization.slug() ?? 'org'}.${id ?? 'new'}`);
    if (id) {
      this.stock.adjustment(id).subscribe({
        next: (adjustment) => {
          this.load(adjustment);
          this.offerRecovery();
        },
        error: (error: unknown) => this.notifications.showHttpError(error, 'inventory.adjustments.load_failed'),
      });
    } else {
      this.addLine(this.productId() ?? '');
      this.stock.adjustmentDateReadiness(this.form.value.date).pipe(catchError(() => of(null))).subscribe((r) => this.dateReadiness.set(r));
      this.offerRecovery();
    }
  }

  addLine(productId = ''): void {
    this.lines.push(this.lineGroup({ productId }));
    if (productId) this.onProductChange(this.lines.length - 1);
  }

  removeLine(index: number): void {
    this.lines.removeAt(index);
    const shift = <T>(record: Record<number, T>): Record<number, T> => {
      const out: Record<number, T> = {};
      Object.entries(record).forEach(([key, value]) => {
        const n = Number(key);
        if (n < index) out[n] = value;
        else if (n > index) out[n - 1] = value;
      });
      return out;
    };
    this.onHand.set(shift(this.onHand()));
    this.lineProducts.set(shift(this.lineProducts()));
    this.form.markAsDirty();
  }

  onProductChange(index: number): void {
    const productId = this.lines.at(index)?.value.productId as string;
    this.refreshOnHand(index);
    if (!productId) {
      this.lineProducts.update((all) => ({ ...all, [index]: null }));
      return;
    }
    this.products
      .getProductById(productId)
      .pipe(catchError(() => of(null)))
      .subscribe((product) => {
        // The line may have changed product while this was on its way.
        if (this.lines.at(index)?.value.productId !== productId) return;
        this.lineProducts.update((all) => ({ ...all, [index]: product ? this.toLineProduct(product) : null }));
        this.revision.update((n) => n + 1);
      });
  }

  protected signClass(value: number | null): string {
    return value === null ? '' : value > 0 ? 'positive' : value < 0 ? 'negative' : '';
  }

  /** The id an input in line `index` carries, for its label, its error and the summary's link. */
  protected lineFieldId(index: number, control: string): string {
    return `adj-line-${index}-${control}`;
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  save(): void {
    void this.saveAsync();
  }

  private saveAsync(): Promise<boolean> {
    if (!this.editable()) return Promise.resolve(false);
    if (!this.validateForm()) return Promise.resolve(false);
    const body = this.body();
    const existing = this.current();
    const creating = !existing;
    this.saving.set(true);
    const request = existing ? this.stock.updateAdjustment(existing.id, body) : this.stock.createAdjustment(body);
    return new Promise((resolve) => {
      request.subscribe({
        next: (adjustment) => {
          this.saving.set(false);
          this.autosave?.clear();
          this.recovered.set(null);
          this.notifications.showSuccess('inventory.adjustments.saved', { number: adjustment.number });
          if (creating && this.tab) {
            this.tab.markClean();
            this.tab.replaceRoute(`/inventory/adjustments/${adjustment.id}`, { title: adjustment.number });
            resolve(true);
            return;
          }
          this.load(adjustment);
          resolve(true);
        },
        error: (error: unknown) => {
          this.fail(error, 'inventory.adjustments.save_failed');
          resolve(false);
        },
      });
    });
  }

  async post(decision?: BalanceChangeDecision): Promise<void> {
    const adjustment = this.current();
    if (!adjustment || !this.editable()) return;
    if (!decision) {
      const impact = this.impact();
      const confirmed = await this.dialog.confirm({
        title: 'inventory.adjustments.post_title',
        message: impact.unknown ? 'inventory.adjustments.post_message_unknown' : 'inventory.adjustments.post_message_impact',
        messageParams: {
          number: adjustment.number,
          lines: impact.lines,
          shortfall: this.money(impact.shortfall),
          surplus: this.money(impact.surplus),
          revaluation: this.money(impact.revaluation),
          net: this.money(impact.net),
        },
        confirmText: 'inventory.adjustments.post',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    this.saving.set(true);
    this.stock.postAdjustment(adjustment.id, decision).subscribe({
      next: (posted) => {
        this.saving.set(false);
        this.conflicts.set(null);
        this.notifications.showSuccess('inventory.adjustments.posted', { number: posted.number });
        this.load(posted);
      },
      error: (error: unknown) => {
        const conflicts = this.balanceConflicts(error);
        if (conflicts) {
          // Not an error to dismiss: a decision to make, shown where the lines are.
          this.saving.set(false);
          this.conflicts.set(conflicts);
          return;
        }
        this.fail(error, 'inventory.adjustments.post_failed');
      },
    });
  }

  dismissConflicts(): void {
    this.conflicts.set(null);
  }

  async cancelDocument(): Promise<void> {
    const adjustment = this.current();
    if (!adjustment || !this.editable()) return;
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
        this.autosave?.clear();
        this.notifications.showSuccess('inventory.adjustments.cancelled', { number: cancelled.number });
        this.load(cancelled);
      },
      error: (error: unknown) => this.fail(error, 'inventory.adjustments.cancel_failed'),
    });
  }

  async reverse(): Promise<void> {
    const adjustment = this.current();
    if (!adjustment || !this.canReverse()) return;
    const reason = await this.dialog.prompt({
      title: 'inventory.adjustments.reverse_title',
      message: 'inventory.adjustments.reverse_message',
      messageParams: { number: adjustment.number },
      placeholder: 'inventory.adjustments.reverse_placeholder',
      confirmText: 'inventory.adjustments.reverse',
      variant: 'warning',
      minLength: 3,
      tooShort: 'inventory.adjustments.reverse_reason_short',
    });
    if (!reason) return;
    this.saving.set(true);
    this.stock.reverseAdjustment(adjustment.id, { reason: reason.trim() }).subscribe({
      next: (reversal) => {
        this.saving.set(false);
        this.notifications.showSuccess('inventory.adjustments.reversed', { number: adjustment.number, reversal: reversal.number });
        void this.router.navigateByUrl(this.organization.urlFor(`/inventory/adjustments/${reversal.id}`));
      },
      error: (error: unknown) => this.fail(error, 'inventory.adjustments.reverse_failed'),
    });
  }

  /** «Cancel»: back to the list — after asking, when there is something to lose. */
  async cancel(): Promise<void> {
    if (this.form.dirty && this.editable()) {
      // A draft not yet saved has no number: «en el ajuste .» read as a typo.
      const number = this.current()?.number;
      const decision = await this.dialog.confirmClose({
        message: number ? 'inventory.adjustments.leave_unsaved' : 'inventory.adjustments.leave_unsaved_new',
        messageParams: number ? { number } : {},
      });
      if (decision === 'cancel') return;
      if (decision === 'save') {
        if (!(await this.saveAsync())) return;
      } else {
        this.autosave?.clear();
        this.tab?.markClean();
      }
    }
    void this.router.navigateByUrl(this.organization.urlFor('/inventory/adjustments'));
  }

  /** Restores the copy of unsaved work this browser kept. */
  restoreRecovered(): void {
    const stored = this.autosave?.load();
    if (!stored) {
      this.recovered.set(null);
      return;
    }
    const value = stored.value as { date?: string; warehouseId?: string; reason?: string; notes?: string; lines?: Array<Record<string, unknown>> };
    this.lines.clear();
    for (const line of value.lines ?? []) this.lines.push(this.lineGroup(line));
    this.form.patchValue({ date: value.date, warehouseId: value.warehouseId, reason: value.reason, notes: value.notes });
    this.form.markAsDirty();
    this.tab?.markDirty(true);
    this.lines.controls.forEach((_, index) => this.onProductChange(index));
    this.recovered.set(null);
  }

  discardRecovered(): void {
    this.autosave?.clear();
    this.recovered.set(null);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private offerRecovery(): void {
    if (!this.editable()) return;
    const stored = this.autosave?.load();
    if (stored) this.recovered.set({ savedAt: stored.savedAt });
  }

  /** Opened from a product: go to the warehouse that holds it, so the line shows a real balance. */
  private placeAtProductWarehouse(productId: string): void {
    this.stock
      .onHand({ productId, limit: 50 })
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        const rows = result?.items ?? [];
        if (rows.length === 0) return;
        const best = [...rows].sort((a, b) => Number(b.quantityOnHand) - Number(a.quantityOnHand))[0];
        if (this.warehouses().some((warehouse) => warehouse.id === best.warehouseId)) {
          this.form.patchValue({ warehouseId: best.warehouseId });
          this.form.markAsPristine();
        }
      });
  }

  private estimate(index: number, line: { countedQuantity: unknown; quantityChange: unknown; unitCost: unknown; newUnitCost: unknown }): LineFigures {
    const product = this.lineProducts()[index] ?? null;
    const held = this.onHand()[index];
    const num = (value: unknown): number | null => (value === null || value === undefined || value === '' ? null : Number(value));
    const counted = num(line.countedQuantity);
    let difference: number | null;
    if (counted !== null) difference = held === null || held === undefined ? null : Math.round((counted - held) * 1e6) / 1e6;
    else difference = num(line.quantityChange) ?? 0;

    let quantityValue = 0;
    if (product && difference !== null && difference !== 0) {
      const enteredAt = num(line.unitCost) ?? product.cost;
      quantityValue = difference > 0 ? round2(difference * enteredAt) : round2(round2((product.stock + difference) * product.cost) - round2(product.stock * product.cost));
    }
    let revaluationValue = 0;
    const newCost = num(line.newUnitCost);
    if (product && newCost !== null && Math.abs(newCost - product.cost) > 1e-9) {
      const stockAfter = Math.max(product.stock + (difference ?? 0), 0);
      const costAfter = difference !== null && difference > 0 && product.stock + difference > 0
        ? (product.stock * product.cost + difference * (num(line.unitCost) ?? product.cost)) / (product.stock + difference)
        : product.cost;
      revaluationValue = round2(round2(stockAfter * newCost) - round2(stockAfter * costAfter));
    }
    return { difference, quantityValue, revaluationValue };
  }

  private validateForm(): boolean {
    const problems = this.collectProblems();
    if (problems.length) {
      this.form.markAllAsTouched();
      this.problems.set(problems);
      return false;
    }
    this.problems.set([]);
    return true;
  }

  private collectProblems(): DraftProblem[] {
    const lineProblems: DraftProblem[] = [];
    this.lines.controls.forEach((control, index) => {
      const line = control.value as { productId: string; countedQuantity: unknown; quantityChange: unknown; newUnitCost: unknown };
      const counted = line.countedQuantity !== null && line.countedQuantity !== '';
      const changed = line.quantityChange !== null && line.quantityChange !== '' && Number(line.quantityChange) !== 0;
      const revalued = line.newUnitCost !== null && line.newUnitCost !== '';
      // A missing product is reported once, by the field's own validator (named «Producto, línea N»).
      if (!line.productId) return;
      if (counted && changed) {
        lineProblems.push({ message: 'inventory.adjustments.line_count_or_change', params: { line: index + 1 }, fieldId: this.lineFieldId(index, 'quantityChange') });
      } else if (!counted && !changed && !revalued) {
        lineProblems.push({ message: 'inventory.adjustments.line_empty', params: { line: index + 1 }, fieldId: this.lineFieldId(index, 'countedQuantity') });
      }
    });
    const ids = this.lines.controls.map((control) => control.value.productId).filter(Boolean);
    const repeated = ids.findIndex((id, index) => ids.indexOf(id) !== index);
    if (repeated >= 0) {
      const lineNumbers = this.lines.controls
        .map((control, index) => (control.value.productId === ids[repeated] ? index + 1 : null))
        .filter((n): n is number => n !== null);
      lineProblems.push({ message: 'inventory.adjustments.repeated_product_lines', params: { lines: lineNumbers.join(', ') } });
    }
    if (this.lines.length === 0) lineProblems.push({ message: 'inventory.common.lines_required' });

    const fieldProblems = draftProblems(this.form, {
      date: 'inventory.common.date',
      warehouseId: 'inventory.common.warehouse',
      reason: 'inventory.adjustments.reason',
      productId: 'inventory.common.product',
      countedQuantity: 'inventory.adjustments.counted',
      quantityChange: 'inventory.adjustments.change',
      unitCost: 'inventory.adjustments.unit_cost_in',
      newUnitCost: 'inventory.adjustments.new_unit_cost',
    }).map((problem) => this.lineProblem(problem));
    return [...fieldProblems, ...lineProblems];
  }

  /** «lines.2.productId» becomes «Producto (línea 3)» pointing at that line's input. */
  private lineProblem(problem: DraftProblem): DraftProblem {
    const match = /^lines\.(\d+)\.(\w+)$/.exec(problem.fieldId ?? '');
    if (!match) return problem;
    const index = Number(match[1]);
    return {
      ...problem,
      message: lineMessage(problem.message),
      fieldId: this.lineFieldId(index, match[2]),
      params: { ...problem.params, line: index + 1 },
    };
  }

  private body(): SaveInventoryAdjustment {
    const raw = this.form.getRawValue();
    const num = (value: unknown): number | null => (value === null || value === undefined || value === '' ? null : Number(value));
    return {
      date: raw.date,
      warehouseId: raw.warehouseId,
      reason: String(raw.reason).trim(),
      notes: String(raw.notes ?? '').trim() || undefined,
      lines: (raw.lines as Record<string, unknown>[]).map((line, index) => {
        const counted = num(line['countedQuantity']);
        const held = this.onHand()[index];
        return {
          productId: String(line['productId']),
          countedQuantity: counted,
          // What the screen showed beside the count: lets the posting notice a balance that moved.
          expectedQuantity: counted === null || held === null || held === undefined ? null : held,
          quantityChange: counted === null ? num(line['quantityChange']) : null,
          unitCost: num(line['unitCost']),
          newUnitCost: num(line['newUnitCost']),
        };
      }),
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
          // A late answer for a line that has since changed product or warehouse is dropped.
          if (this.lines.at(i)?.value.productId !== productId || this.form.value.warehouseId !== warehouseId) return;
          this.onHand.update((all) => ({ ...all, [i]: result ? Number(result.items[0]?.quantityOnHand ?? 0) : null }));
          this.revision.update((n) => n + 1);
        });
    }
  }

  private balanceConflicts(error: unknown): BalanceConflict[] | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
    const body = error.error as { messageKey?: string; params?: { lines?: BalanceConflict[] } } | null;
    return body?.messageKey === 'inventory.adjustment_balance_changed' ? body.params?.lines ?? [] : null;
  }

  /** An amount in the books' currency, formatted the way the rest of the screen shows it. */
  private money(value: number): string {
    return this.format.money(value);
  }

  private today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private toLineProduct(product: Product): LineProduct {
    return {
      sku: product.sku ?? null,
      name: product.name,
      unitOfMeasure: product.unitOfMeasure ?? null,
      cost: Number(product.cost ?? 0),
      stock: Number(product.stock ?? 0),
      active: product.status !== 'Inactive',
    };
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
    const products: Record<number, LineProduct | null> = {};
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
      products[index] = null;
    });
    this.onHand.set(held);
    this.lineProducts.set(products);
    this.form.patchValue(
      {
        date: String(adjustment.date).slice(0, 10),
        warehouseId: adjustment.warehouseId,
        reason: adjustment.reason,
        notes: adjustment.notes ?? '',
      },
      { emitEvent: false },
    );
    if (this.editable()) {
      this.form.enable({ emitEvent: false });
      this.lines.controls.forEach((_, index) => this.onProductChange(index));
    } else {
      this.form.disable({ emitEvent: false });
    }
    this.dateReadiness.set(adjustment.readiness?.date ?? null);
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.problems.set([]);
    this.revision.update((n) => n + 1);
    this.tab?.markClean();
  }
}
