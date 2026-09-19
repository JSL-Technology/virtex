import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { NotificationService } from '../../../../core/services/notification';
import {
  PurchaseRequisition,
  PurchaseRequisitionStatus,
  PurchasingService,
} from '../../../../core/api/purchasing.service';
import { InventoryService } from '../../../../core/api/inventory.service';
import { Product } from '../../../../core/models/product.model';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxBadgeComponent, VxTone } from '../../../../shared/components/badge';
import { VxAmountComponent } from '../../../../shared/components/amount';

/**
 * Raising and deciding a purchase requisition.
 *
 * The screen this belongs to listed three requisitions invented in the browser and had no form at
 * all: the "New requisition" button led nowhere. What a requisition needs, and what this carries:
 * lines saying what is actually wanted, an estimate per line so an approver can see the size of
 * the commitment, a date it is needed by, and the reason — which is the thing an approver actually
 * reads before deciding.
 *
 * The lifecycle buttons live here rather than on the list because the decision belongs next to
 * what is being decided.
 */
@Component({
  selector: 'app-requisition-form-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    DraftShellComponent,
    ...VX_FORM_A11Y, VxBadgeComponent, VxAmountComponent],
  templateUrl: './form.page.html',
  styleUrls: ['./form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequisitionFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly purchasing = inject(PurchasingService);
  private readonly inventory = inject(InventoryService);
  private readonly notifications = inject(NotificationService);
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  /** Delivered as a component input by the tab shell, which mounts pages outside the outlet. */
  @Input() id?: string;

  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = Trash2;

  form!: FormGroup;
  readonly saving = signal(false);
  readonly products = signal<Product[]>([]);
  readonly current = signal<PurchaseRequisition | null>(null);
  readonly problems = signal<DraftProblem[]>([]);

  readonly isNew = computed(() => !this.current());
  readonly status = computed<PurchaseRequisitionStatus | null>(() => this.current()?.status ?? null);

  /** El mismo vocabulario que la lista de solicitudes, y ahora la misma tabla. */
  readonly statusTone = computed<VxTone>(() => {
    switch (this.status()) {
      case 'APPROVED':
        return 'ok';
      case 'CONVERTED_TO_PO':
        return 'info';
      case 'PENDING_APPROVAL':
        return 'warning';
      case 'REJECTED':
        return 'danger';
      default:
        return 'draft';
    }
  });

  /** Only a draft may be edited: a document under review cannot change under its reviewer. */
  readonly editable = computed(() => this.isNew() || this.status() === 'DRAFT');
  readonly canSubmit = computed(() => this.status() === 'DRAFT');
  readonly canDecide = computed(() => this.status() === 'PENDING_APPROVAL');
  readonly canReopen = computed(
    () => this.status() === 'REJECTED' || this.status() === 'PENDING_APPROVAL',
  );

  readonly total = signal(0);

  ngOnInit(): void {
    this.form = this.fb.group({
      requiredDate: [''],
      notes: [''],
      lines: this.fb.array([]),
    });

    this.inventory.getProducts().subscribe({
      next: (data) => this.products.set(data),
      error: () => this.products.set([]),
    });

    if (this.id) {
      this.purchasing.getRequisition(this.id).subscribe({
        next: (requisition) => this.load(requisition),
        error: () => this.notifications.showError('procurement.requisition_not_found'),
      });
    } else {
      this.addLine();
    }

    this.form.valueChanges.subscribe(() => this.recomputeTotal());
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  addLine(): void {
    this.lines.push(
      this.fb.group({
        productId: [''],
        description: ['', [Validators.required]],
        quantity: [1, [Validators.required, Validators.min(0.000001)]],
        estimatedUnitPrice: [0, [Validators.min(0)]],
        unitOfMeasure: ['UND'],
      }),
    );
  }

  removeLine(index: number): void {
    this.lines.removeAt(index);
    this.recomputeTotal();
  }

  /**
   * Picking a catalogue product fills the line in.
   *
   * The description stays editable afterwards: what the requester writes is what the approver and
   * then the supplier read, and "Tóner negro, el de la impresora de recepción" is more useful than
   * the catalogue's name.
   */
  onProductChange(index: number, productId: string): void {
    const product = this.products().find((candidate) => candidate.id === productId);
    if (!product) return;
    const line = this.lines.at(index);
    line.patchValue({
      description: line.value.description || product.name,
      estimatedUnitPrice: Number(product.cost) || 0,
      unitOfMeasure: product.unitOfMeasure ?? 'UND',
    });
  }

  lineTotal(line: { quantity: number; estimatedUnitPrice: number }): number {
    return round(Number(line.quantity || 0) * Number(line.estimatedUnitPrice || 0));
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.problems.set(
        draftProblems(this.form, {
          description: 'purchasing.requisitions.form.description',
          quantity: 'purchasing.requisitions.form.quantity',
        }),
      );
      return;
    }
    this.problems.set([]);

    const raw = this.form.getRawValue();
    const body = {
      requiredDate: raw.requiredDate || undefined,
      notes: raw.notes || undefined,
      lines: (raw.lines as Record<string, string | number>[]).map((line) => ({
        productId: (line['productId'] as string) || undefined,
        description: String(line['description']),
        quantity: Number(line['quantity']),
        estimatedUnitPrice: Number(line['estimatedUnitPrice']) || 0,
        unitOfMeasure: String(line['unitOfMeasure'] || 'UND'),
      })),
    };

    this.saving.set(true);
    const request = this.current()
      ? this.purchasing.updateRequisition(this.current()!.id, body)
      : this.purchasing.createRequisition(body);

    const creating = !this.current();

    request.subscribe({
      next: (requisition) => {
        this.saving.set(false);
        this.notifications.showSuccess('purchasing.requisitions.form.saved');

        //  Ya no es «Nueva requisición»: la ventana y la URL pasan a la requisición, que se vuelve
        //  a montar sobre su propia ruta. Ver `TabContext.replaceRoute`.
        if (creating && this.tab) {
          this.tab.replaceRoute(`/purchasing/requisitions/${requisition.id}/edit`, {
            title: requisition.number,
          });
          return;
        }

        this.load(requisition);
      },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  submit(): void {
    this.act(this.purchasing.submitRequisition(this.current()!.id));
  }

  approve(): void {
    this.act(this.purchasing.approveRequisition(this.current()!.id));
  }

  /**
   * Rejecting asks for a reason first.
   *
   * Inline rather than through a browser prompt: a rejection with no reason leaves the requester
   * guessing what to change, and `window.prompt` cannot be styled, translated or tested.
   */
  readonly rejecting = signal(false);
  readonly rejectionReason = signal('');

  startReject(): void {
    this.rejecting.set(true);
  }

  cancelReject(): void {
    this.rejecting.set(false);
    this.rejectionReason.set('');
  }

  confirmReject(): void {
    const reason = this.rejectionReason().trim();
    if (reason.length < 3) return;
    this.act(this.purchasing.rejectRequisition(this.current()!.id, reason));
    this.cancelReject();
  }

  reopen(): void {
    this.act(this.purchasing.reopenRequisition(this.current()!.id));
  }

  cancel(): void {
    void this.router.navigate(['/purchasing/requisitions']);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private act(request: ReturnType<PurchasingService['submitRequisition']>): void {
    this.saving.set(true);
    request.subscribe({
      next: (requisition) => {
        this.saving.set(false);
        this.load(requisition);
      },
      error: (error: { error?: { message?: string } }) => this.fail(error),
    });
  }

  private fail(error: { error?: { message?: string } }): void {
    this.saving.set(false);
    const message = error?.error?.message;
    this.notifications.showError(
      typeof message === 'string' ? message : 'purchasing.requisitions.form.save_failed',
    );
  }

  private load(requisition: PurchaseRequisition): void {
    this.current.set(requisition);
    this.lines.clear();
    for (const line of requisition.lines ?? []) {
      this.lines.push(
        this.fb.group({
          productId: [line.productId ?? ''],
          description: [line.description, [Validators.required]],
          quantity: [Number(line.quantity), [Validators.required, Validators.min(0.000001)]],
          estimatedUnitPrice: [Number(line.estimatedUnitPrice), [Validators.min(0)]],
          unitOfMeasure: [line.unitOfMeasure ?? 'UND'],
        }),
      );
    }
    this.form.patchValue(
      { requiredDate: requisition.requiredDate ?? '', notes: requisition.notes ?? '' },
      { emitEvent: false },
    );
    if (!this.editable()) this.form.disable({ emitEvent: false });
    else this.form.enable({ emitEvent: false });

    //  Lo que hay en pantalla es lo que hay en el servidor. Ver la nota en el formulario de
    //  empleado sobre por qué el indicador de «Sin guardar» tiene que dejar de mentir.
    this.form.markAsPristine();
    this.tab?.markClean();

    this.recomputeTotal();
  }

  private recomputeTotal(): void {
    this.total.set(
      round(
        this.lines.controls.reduce((sum, line) => sum + this.lineTotal(line.value), 0),
      ),
    );
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
