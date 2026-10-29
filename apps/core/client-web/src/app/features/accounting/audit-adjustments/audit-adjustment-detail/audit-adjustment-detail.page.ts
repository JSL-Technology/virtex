import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Paperclip, Upload } from 'lucide-angular';
import { catchError, forkJoin, of } from 'rxjs';

import { TranslateModule, FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { DocumentShellComponent, DocumentTone } from '../../../../shared/components/gestures';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../../core/services/notification';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { AdjustmentStatus, AuditAdjustmentsService, ProposedAdjustment } from '../../../../core/api/audit-adjustments.service';
import { ChartOfAccountsApiService } from '../../data/chart-of-accounts.service';

export const AUDIT_ADJUSTMENT_STATUS: Record<AdjustmentStatus, { key: string; tone: DocumentTone }> = {
  PENDING_APPROVAL: { key: 'audit_adjustments.status.pending_approval', tone: 'warning' },
  APPROVED: { key: 'audit_adjustments.status.approved', tone: 'info' },
  REJECTED: { key: 'audit_adjustments.status.rejected', tone: 'neutral' },
  POSTED: { key: 'audit_adjustments.status.posted', tone: 'ok' },
  FAILED: { key: 'audit_adjustments.status.failed', tone: 'danger' },
};

/** Evidence files the server accepts: what a working paper is. */
const EVIDENCE_TYPES = '.pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.docx,.doc';

/**
 * One proposed audit adjustment: what it corrects, by whom, where it stands, and its evidence.
 *
 * The list's rows could not be opened before, so the lines an auditor proposed, the working papers
 * behind them and the entry the proposal became were nowhere to be seen once it was submitted.
 */
@Component({
  selector: 'app-audit-adjustment-detail-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, DocumentShellComponent, HasPermissionDirective],
  templateUrl: './audit-adjustment-detail.page.html',
  styleUrls: ['../../../../shared/styles/document-form.scss', './audit-adjustment-detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditAdjustmentDetailPage implements OnInit {
  private readonly adjustments = inject(AuditAdjustmentsService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input.required<string>();

  protected readonly EvidenceIcon = Paperclip;
  protected readonly UploadIcon = Upload;
  protected readonly evidenceTypes = EVIDENCE_TYPES;

  readonly proposal = signal<ProposedAdjustment | null>(null);
  readonly accountNames = signal<Record<string, string>>({});
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly uploading = signal(false);

  readonly status = computed(() => {
    const proposal = this.proposal();
    return proposal ? AUDIT_ADJUSTMENT_STATUS[proposal.status] : null;
  });
  readonly totals = computed(() => {
    const lines = this.proposal()?.lines ?? [];
    const sum = (pick: (line: { debit: number; credit: number }) => number) =>
      lines.reduce((total, line) => total + Math.round(Number(pick(line) || 0) * 100), 0) / 100;
    return { debit: sum((line) => line.debit), credit: sum((line) => line.credit) };
  });
  readonly entryLink = computed(() => {
    const entry = this.proposal()?.journalEntryId;
    return entry ? this.organization.urlFor(`/accounting/journal-entries/${entry}/edit`) : null;
  });
  readonly canAttach = computed(() => this.proposal()?.status === 'PENDING_APPROVAL');

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.adjustments.findOne(this.id()).subscribe({
      next: (proposal) => {
        this.proposal.set(proposal);
        this.loading.set(false);
        this.tab?.setTitle(`${proposal.fiscalYear?.endDate?.slice(0, 4) ?? ''} · ${proposal.description}`.trim());
        this.resolveAccounts(proposal);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(this.notifications.httpErrorMessage(error, 'audit_adjustments.load_failed'));
      },
    });
  }

  goToList(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounting/audit-adjustments'));
  }

  attach(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploading.set(true);
    this.adjustments.addEvidence(this.id(), file).subscribe({
      next: () => {
        this.uploading.set(false);
        this.notifications.showSuccess('audit_adjustments.evidence_attached', { name: file.name });
        this.load();
      },
      error: (error: unknown) => {
        this.uploading.set(false);
        this.notifications.showHttpError(error, 'audit_adjustments.evidence_failed');
      },
    });
  }

  private resolveAccounts(proposal: ProposedAdjustment): void {
    const ids = [...new Set(proposal.lines.map((line) => line.accountId))];
    if (ids.length === 0) return;
    forkJoin(ids.map((id) => this.accounts.getAccountById(id).pipe(catchError(() => of(null))))).subscribe((rows) => {
      const names: Record<string, string> = {};
      rows.forEach((account, index) => {
        names[ids[index]] = account ? `${account.code} — ${accountNameOf(account.name)}` : ids[index].slice(0, 8);
      });
      this.accountNames.set(names);
    });
  }
}
