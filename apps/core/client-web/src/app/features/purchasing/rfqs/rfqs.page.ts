import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, forkJoin, of } from 'rxjs';
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
import { PurchaseRequisition, PurchasingService, Rfq, RfqComparison, RfqStatus } from '../data/purchasing.service';

const STATUS_TONE: Record<RfqStatus, VxTone> = { DRAFT: 'neutral', SENT: 'info', AWARDED: 'ok', CANCELLED: 'danger' };

interface DraftLine { description: string; quantity: number | null }

/**
 * Requests for quotation (audit 2026-11-07, CMP-15). What is needed is asked of several
 * suppliers; their quotations are recorded per line, compared side by side, and one is awarded —
 * which becomes a draft purchase order at its prices. A dearer winner takes a written reason.
 */
@Component({
  selector: 'app-rfqs-page',
  standalone: true,
  imports: [FormsModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, ListShellComponent, HasPermissionDirective, VxBadgeComponent, RouterLink],
  templateUrl: './rfqs.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RfqsPage implements OnInit {
  private readonly purchasing = inject(PurchasingService);
  private readonly suppliersApi = inject(SuppliersService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly rfqs = signal<Rfq[]>([]);
  readonly requisitions = signal<PurchaseRequisition[]>([]);
  readonly selected = signal<Rfq | null>(null);
  readonly comparison = signal<RfqComparison | null>(null);
  readonly supplierNames = signal<Record<string, string>>({});
  readonly busy = signal(false);

  readonly draft = signal<{ title: string; requisitionId: string; responseDueDate: string; supplierIds: string[]; lines: DraftLine[] }>(this.emptyDraft());
  readonly pickedSupplier = signal<string | null>(null);
  readonly canCreate = computed(() => {
    const d = this.draft();
    const lines = d.requisitionId ? true : d.lines.some((l) => l.description.trim() && (l.quantity ?? 0) > 0);
    return d.title.trim().length > 0 && d.supplierIds.length > 0 && lines;
  });

  readonly quote = signal<{ supplierId: string; reference: string; validUntil: string; leadTimeDays: number | null; prices: Record<string, { unitPrice: number | null; taxPercent: number | null }> }>(this.emptyQuote());

  protected readonly tone = (status: RfqStatus): VxTone => STATUS_TONE[status];
  protected readonly searchSuppliers = (query: string, limit: number): Observable<Supplier[]> => this.suppliersApi.searchSuppliers(query, limit);
  protected readonly resolveSupplier = (id: string): Observable<Supplier> => this.suppliersApi.getSupplierById(id);
  protected readonly supplierLabel = (supplier: Supplier): string => supplier.name;
  protected readonly supplierIdOf = (supplier: Supplier): string => supplier.id;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({ rfqs: this.purchasing.rfqs(), requisitions: this.purchasing.listRequisitions(1, 100) }).subscribe({
      next: ({ rfqs, requisitions }) => {
        this.rfqs.set(rfqs);
        this.requisitions.set(requisitions.rows.filter((r) => r.status === 'APPROVED'));
        this.error.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  nameOf(supplierId: string): string {
    return this.supplierNames()[supplierId] ?? '…';
  }

  private rememberSupplier(id: string): void {
    if (this.supplierNames()[id]) return;
    this.suppliersApi.getSupplierById(id).subscribe((supplier) => this.supplierNames.update((names) => ({ ...names, [id]: supplier.name })));
  }

  // ── Create ──────────────────────────────────────────────────────────────

  patchDraft(patch: Partial<{ title: string; requisitionId: string; responseDueDate: string }>): void {
    this.draft.update((d) => ({ ...d, ...patch }));
  }

  patchLine(index: number, patch: Partial<DraftLine>): void {
    this.draft.update((d) => ({ ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  }

  addLine(): void {
    this.draft.update((d) => ({ ...d, lines: [...d.lines, { description: '', quantity: null }] }));
  }

  removeLine(index: number): void {
    this.draft.update((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }));
  }

  invite(supplierId: string | null): void {
    if (!supplierId) return;
    this.rememberSupplier(supplierId);
    this.draft.update((d) => ({ ...d, supplierIds: [...new Set([...d.supplierIds, supplierId])] }));
    this.pickedSupplier.set(null);
  }

  uninvite(supplierId: string): void {
    this.draft.update((d) => ({ ...d, supplierIds: d.supplierIds.filter((id) => id !== supplierId) }));
  }

  create(): void {
    const d = this.draft();
    if (!this.canCreate()) return;
    this.busy.set(true);
    this.purchasing
      .createRfq({
        title: d.title.trim(),
        supplierIds: d.supplierIds,
        ...(d.requisitionId ? { requisitionId: d.requisitionId } : { lines: d.lines.filter((l) => l.description.trim() && (l.quantity ?? 0) > 0).map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity) })) }),
        ...(d.responseDueDate ? { responseDueDate: d.responseDueDate } : {}),
      })
      .subscribe({
        next: (rfq) => {
          this.busy.set(false);
          this.draft.set(this.emptyDraft());
          this.notifications.showSuccess('purchasing.rfqs.created');
          this.load();
          this.open(rfq);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  // ── Detail ──────────────────────────────────────────────────────────────

  open(row: Rfq): void {
    this.purchasing.rfq(row.id).subscribe({
      next: (rfq) => {
        this.selected.set(rfq);
        this.quote.set(this.emptyQuote());
        for (const invite of rfq.suppliers ?? []) this.rememberSupplier(invite.supplierId);
        (rfq.status === 'DRAFT' ? of(null) : this.purchasing.rfqComparison(rfq.id)).subscribe((comparison) => this.comparison.set(comparison));
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'purchasing.rfqs.not_saved'),
    });
  }

  send(): void {
    const rfq = this.selected();
    if (!rfq) return;
    this.act(this.purchasing.sendRfq(rfq.id), 'purchasing.rfqs.sent');
  }

  async cancel(): Promise<void> {
    const rfq = this.selected();
    if (!rfq) return;
    const reason = await this.dialog.prompt({
      title: 'purchasing.rfqs.cancel_title',
      message: 'purchasing.rfqs.cancel_message',
      placeholder: 'purchasing.rfqs.reason',
      minLength: 3,
      tooShort: 'purchasing.rfqs.reason_too_short',
      variant: 'danger',
    });
    if (!reason) return;
    this.act(this.purchasing.cancelRfq(rfq.id, reason.trim()), 'purchasing.rfqs.cancelled');
  }

  patchQuote(patch: Partial<{ supplierId: string; reference: string; validUntil: string; leadTimeDays: number | null }>): void {
    this.quote.update((q) => ({ ...q, ...patch }));
  }

  patchPrice(lineId: string, patch: Partial<{ unitPrice: number | null; taxPercent: number | null }>): void {
    this.quote.update((q) => ({ ...q, prices: { ...q.prices, [lineId]: { unitPrice: null, taxPercent: null, ...q.prices[lineId], ...patch } } }));
  }

  recordQuote(): void {
    const rfq = this.selected();
    const q = this.quote();
    if (!rfq || !q.supplierId || !q.validUntil) {
      this.notifications.showError('purchasing.rfqs.quote_incomplete');
      return;
    }
    const lines = (rfq.lines ?? [])
      .filter((line) => q.prices[line.id]?.unitPrice !== null && q.prices[line.id]?.unitPrice !== undefined)
      .map((line) => ({ rfqLineId: line.id, unitPrice: Number(q.prices[line.id].unitPrice), taxRate: Number(q.prices[line.id].taxPercent ?? 0) / 100 }));
    if (lines.length === 0) {
      this.notifications.showError('purchasing.rfqs.quote_incomplete');
      return;
    }
    this.busy.set(true);
    this.purchasing
      .recordQuote(rfq.id, { supplierId: q.supplierId, validUntil: q.validUntil, lines, ...(q.reference.trim() ? { reference: q.reference.trim() } : {}), ...(q.leadTimeDays !== null ? { leadTimeDays: Number(q.leadTimeDays) } : {}) })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.notifications.showSuccess('purchasing.rfqs.quote_recorded');
          this.open(rfq);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  /** Award: the cheapest eligible quotation needs no reason; any other does. */
  async award(quoteId: string, cheapest: boolean): Promise<void> {
    const rfq = this.selected();
    if (!rfq) return;
    let reason: string | undefined;
    if (cheapest) {
      const confirmed = await this.dialog.confirm({ title: 'purchasing.rfqs.award_title', message: 'purchasing.rfqs.award_message', confirmText: 'purchasing.rfqs.award' });
      if (!confirmed) return;
    } else {
      const given = await this.dialog.prompt({
        title: 'purchasing.rfqs.award_title',
        message: 'purchasing.rfqs.award_not_cheapest',
        placeholder: 'purchasing.rfqs.reason',
        minLength: 3,
        tooShort: 'purchasing.rfqs.reason_too_short',
      });
      if (!given) return;
      reason = given.trim();
    }
    this.busy.set(true);
    this.purchasing.awardQuote(rfq.id, quoteId, reason).subscribe({
      next: (order) => {
        this.busy.set(false);
        this.notifications.showSuccess('purchasing.rfqs.awarded');
        this.router.navigate(['/purchasing/orders', order.id, 'edit']);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  private act(request: Observable<Rfq>, doneKey: string): void {
    this.busy.set(true);
    request.subscribe({
      next: (rfq) => {
        this.busy.set(false);
        this.notifications.showSuccess(doneKey);
        this.load();
        this.open(rfq);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.notifications.showHttpError(error, 'purchasing.rfqs.not_saved');
  }

  private emptyDraft() {
    return { title: '', requisitionId: '', responseDueDate: '', supplierIds: [] as string[], lines: [{ description: '', quantity: null }] as DraftLine[] };
  }

  private emptyQuote() {
    return { supplierId: '', reference: '', validUntil: '', leadTimeDays: null as number | null, prices: {} as Record<string, { unitPrice: number | null; taxPercent: number | null }> };
  }
}
