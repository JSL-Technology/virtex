import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VX_SELECT } from '../../../shared/components/select';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { Supplier } from '../../../core/models/supplier.model';
import { AgreementStatus, PurchaseAgreement, PurchasingService } from '../data/purchasing.service';

const STATUS_TONE: Record<AgreementStatus, VxTone> = { DRAFT: 'neutral', ACTIVE: 'ok', CLOSED: 'info', CANCELLED: 'danger' };

interface DraftLine { description: string; unitPrice: number | null; taxPercent: number | null; maxQuantity: number | null }

/**
 * Purchase agreements — blanket orders (audit 2026-11-07, CMP-15). Prices agreed with a supplier
 * for a period, with a ceiling per line and optionally overall; orders are released against it at
 * those prices. What each line has used is read from the release orders, by the server.
 */
@Component({
  selector: 'app-purchase-agreements-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, ListShellComponent, HasPermissionDirective, VxBadgeComponent],
  templateUrl: './agreements.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PurchaseAgreementsPage implements OnInit {
  private readonly purchasing = inject(PurchasingService);
  private readonly suppliersApi = inject(SuppliersService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly agreements = signal<PurchaseAgreement[]>([]);
  readonly selected = signal<PurchaseAgreement | null>(null);
  readonly busy = signal(false);
  readonly release = signal<Record<string, number | null>>({});

  readonly draft = signal<{ title: string; supplierId: string | null; validFrom: string; validTo: string; maxAmount: number | null; lines: DraftLine[] }>(this.emptyDraft());
  readonly canCreate = computed(() => {
    const d = this.draft();
    return Boolean(d.title.trim() && d.supplierId && d.validFrom && d.validTo) && d.lines.some((l) => l.description.trim() && (l.unitPrice ?? -1) >= 0);
  });

  protected readonly tone = (status: AgreementStatus): VxTone => STATUS_TONE[status];
  protected readonly searchSuppliers = (query: string, limit: number): Observable<Supplier[]> => this.suppliersApi.searchSuppliers(query, limit);
  protected readonly resolveSupplier = (id: string): Observable<Supplier> => this.suppliersApi.getSupplierById(id);
  protected readonly supplierLabel = (supplier: Supplier): string => supplier.name;
  protected readonly supplierIdOf = (supplier: Supplier): string => supplier.id;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.purchasing.agreements().subscribe({
      next: (rows) => {
        this.agreements.set(rows);
        this.error.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  patchDraft(patch: Partial<{ title: string; supplierId: string | null; validFrom: string; validTo: string; maxAmount: number | null }>): void {
    this.draft.update((d) => ({ ...d, ...patch }));
  }

  patchLine(index: number, patch: Partial<DraftLine>): void {
    this.draft.update((d) => ({ ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  }

  addLine(): void {
    this.draft.update((d) => ({ ...d, lines: [...d.lines, { description: '', unitPrice: null, taxPercent: null, maxQuantity: null }] }));
  }

  removeLine(index: number): void {
    this.draft.update((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }));
  }

  create(): void {
    const d = this.draft();
    if (!this.canCreate()) return;
    this.busy.set(true);
    this.purchasing
      .createAgreement({
        title: d.title.trim(),
        supplierId: d.supplierId as string,
        validFrom: d.validFrom,
        validTo: d.validTo,
        ...(d.maxAmount ? { maxAmount: Number(d.maxAmount) } : {}),
        lines: d.lines
          .filter((l) => l.description.trim() && (l.unitPrice ?? -1) >= 0)
          .map((l) => ({
            description: l.description.trim(),
            unitPrice: Number(l.unitPrice),
            taxRate: Number(l.taxPercent ?? 0) / 100,
            ...(l.maxQuantity ? { maxQuantity: Number(l.maxQuantity) } : {}),
          })),
      })
      .subscribe({
        next: (agreement) => {
          this.busy.set(false);
          this.draft.set(this.emptyDraft());
          this.notifications.showSuccess('purchasing.agreements.created');
          this.load();
          this.selected.set(agreement);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  open(row: PurchaseAgreement): void {
    this.purchasing.agreement(row.id).subscribe({
      next: (agreement) => {
        this.selected.set(agreement);
        this.release.set({});
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'purchasing.agreements.not_saved'),
    });
  }

  activate(): void {
    const agreement = this.selected();
    if (agreement) this.act(this.purchasing.activateAgreement(agreement.id), 'purchasing.agreements.activated');
  }

  async close(): Promise<void> {
    const agreement = this.selected();
    if (!agreement) return;
    const reason = await this.dialog.prompt({
      title: 'purchasing.agreements.close_title',
      message: 'purchasing.agreements.close_message',
      placeholder: 'purchasing.rfqs.reason',
      minLength: 3,
      tooShort: 'purchasing.rfqs.reason_too_short',
      variant: 'danger',
    });
    if (!reason) return;
    this.act(this.purchasing.closeAgreement(agreement.id, reason.trim()), 'purchasing.agreements.closed');
  }

  patchRelease(lineId: string, quantity: number | null): void {
    this.release.update((r) => ({ ...r, [lineId]: quantity }));
  }

  releaseOrder(): void {
    const agreement = this.selected();
    if (!agreement) return;
    const lines = Object.entries(this.release())
      .filter(([, quantity]) => (quantity ?? 0) > 0)
      .map(([agreementLineId, quantity]) => ({ agreementLineId, quantity: Number(quantity) }));
    if (lines.length === 0) {
      this.notifications.showError('purchasing.agreements.release_empty');
      return;
    }
    this.busy.set(true);
    this.purchasing.releaseAgreement(agreement.id, lines).subscribe({
      next: (order) => {
        this.busy.set(false);
        this.notifications.showSuccess('purchasing.agreements.released');
        this.router.navigate(['/purchasing/orders', order.id, 'edit']);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  private act(request: Observable<PurchaseAgreement>, doneKey: string): void {
    this.busy.set(true);
    request.subscribe({
      next: (agreement) => {
        this.busy.set(false);
        this.notifications.showSuccess(doneKey);
        this.selected.set(agreement);
        this.load();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.notifications.showHttpError(error, 'purchasing.agreements.not_saved');
  }

  private emptyDraft() {
    return { title: '', supplierId: null as string | null, validFrom: '', validTo: '', maxAmount: null as number | null, lines: [{ description: '', unitPrice: null, taxPercent: null, maxQuantity: null }] as DraftLine[] };
  }
}
