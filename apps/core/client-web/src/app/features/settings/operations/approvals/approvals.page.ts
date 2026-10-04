import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { environment } from '../../../../../environments/environment';
import { NotificationService } from '../../../../core/services/notification';
import { DialogService } from '../../../../core/services/dialog.service';
import { VX_SELECT } from '../../../../shared/components/select';
import { RolesService, Role } from '../../data/roles.service';

export const APPROVAL_DOCUMENT_TYPES = ['VENDOR_BILL', 'PAYMENT_BATCH', 'JOURNAL_ENTRY', 'PERIOD_REOPENING', 'AUDIT_ADJUSTMENT'] as const;
type ApprovalDocumentType = (typeof APPROVAL_DOCUMENT_TYPES)[number];

interface PolicyStep {
  order: number;
  minAmount: number;
  roleId: string;
}

interface ApprovalPolicy {
  id: string;
  name: string;
  documentType: ApprovalDocumentType;
  steps: PolicyStep[];
}

interface PolicyDraft {
  id: string | null;
  name: string;
  documentType: ApprovalDocumentType;
  steps: PolicyStep[];
}

/**
 * Who approves what, from which amount (QA M-09: «Aprobaciones» said «En desarrollo»).
 *
 * The workflow engine and its policy API existed — a policy per document type, steps in order,
 * each with a minimum amount and the role that decides — and nothing in the product could create
 * one. A step applies when the document's amount reaches its minimum, so «0 → Contador, 100 000 →
 * Gerente» asks the accountant for everything and adds the manager above a hundred thousand.
 * Purchase orders and requisitions follow their own rules (segregation of duties) and appear in
 * the same approvals inbox.
 */
@Component({
  selector: 'app-approval-policies-page',
  standalone: true,
  imports: [FormsModule, TranslateModule, ...VX_SELECT, ...FORMAT_PIPES],
  templateUrl: './approvals.page.html',
  styleUrls: ['./approvals.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalPoliciesPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly roles = inject(RolesService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly translate = inject(TranslateService);
  private readonly url = `${environment.apiUrl}/workflows/policies`;

  protected readonly documentTypes = APPROVAL_DOCUMENT_TYPES;
  readonly policies = signal<ApprovalPolicy[]>([]);
  readonly roleList = signal<Role[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly draft = signal<PolicyDraft | null>(null);

  private readonly roleNames = computed(() => new Map(this.roleList().map((role) => [role.id, role.name])));

  /** One policy per document type: the types still free, for a new one. */
  readonly freeTypes = computed(() => {
    const used = new Set(this.policies().map((policy) => policy.documentType));
    return APPROVAL_DOCUMENT_TYPES.filter((type) => !used.has(type));
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({ policies: this.http.get<ApprovalPolicy[]>(this.url), roles: this.roles.getRoles() }).subscribe({
      next: ({ policies, roles }) => {
        this.policies.set(policies.map((policy) => ({ ...policy, steps: [...policy.steps].sort((a, b) => a.order - b.order) })));
        this.roleList.set(roles);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(this.notifications.httpErrorMessage(error, 'settings.approvals.load_failed'));
      },
    });
  }

  readonly roleLabel = (role: Role): string => role.name;
  readonly roleValue = (role: Role): string => role.id;
  readonly typeLabel = (type: ApprovalDocumentType): string => this.translate.instant(this.typeKey(type));

  typeKey(type: ApprovalDocumentType): string {
    return `approvals.document_type.${type.toLowerCase()}`;
  }

  roleName(id: string): string {
    return this.roleNames().get(id) ?? '—';
  }

  startNew(): void {
    const type = this.freeTypes()[0];
    if (!type) return;
    this.draft.set({ id: null, name: '', documentType: type, steps: [{ order: 1, minAmount: 0, roleId: '' }] });
  }

  edit(policy: ApprovalPolicy): void {
    this.draft.set({ id: policy.id, name: policy.name, documentType: policy.documentType, steps: policy.steps.map((s) => ({ ...s })) });
  }

  cancel(): void {
    this.draft.set(null);
  }

  patchDraft(patch: Partial<PolicyDraft>): void {
    this.draft.update((draft) => (draft ? { ...draft, ...patch } : draft));
  }

  patchStep(index: number, patch: Partial<PolicyStep>): void {
    this.draft.update((draft) =>
      draft ? { ...draft, steps: draft.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) } : draft,
    );
  }

  addStep(): void {
    this.draft.update((draft) => {
      if (!draft) return draft;
      const last = draft.steps[draft.steps.length - 1];
      return { ...draft, steps: [...draft.steps, { order: draft.steps.length + 1, minAmount: last?.minAmount ?? 0, roleId: '' }] };
    });
  }

  removeStep(index: number): void {
    this.draft.update((draft) =>
      draft ? { ...draft, steps: draft.steps.filter((_, i) => i !== index).map((step, i) => ({ ...step, order: i + 1 })) } : draft,
    );
  }

  /** What is wrong with the draft, as a key, or null. Said before sending. */
  problem(draft: PolicyDraft): string | null {
    if (!draft.name.trim()) return 'settings.approvals.name_required';
    if (draft.steps.length === 0) return 'settings.approvals.steps_required';
    if (draft.steps.some((step) => !step.roleId)) return 'settings.approvals.role_required';
    if (draft.steps.some((step) => !(step.minAmount >= 0))) return 'settings.approvals.amount_invalid';
    return null;
  }

  save(): void {
    const draft = this.draft();
    if (!draft) return;
    const problem = this.problem(draft);
    if (problem) {
      this.notifications.showError(problem);
      return;
    }
    const steps = draft.steps.map((step, i) => ({ order: i + 1, minAmount: Number(step.minAmount), roleId: step.roleId }));
    const request = draft.id
      ? this.http.patch(`${this.url}/${draft.id}`, { name: draft.name.trim(), steps })
      : this.http.post(this.url, { name: draft.name.trim(), documentType: draft.documentType, steps });
    this.saving.set(true);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.draft.set(null);
        this.notifications.showSuccess('settings.approvals.saved');
        this.load();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'settings.approvals.save_failed');
      },
    });
  }

  async remove(policy: ApprovalPolicy): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'settings.approvals.delete_title',
      message: 'settings.approvals.delete_message',
      messageParams: { name: policy.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.http.delete(`${this.url}/${policy.id}`).subscribe({
      next: () => {
        this.notifications.showSuccess('settings.approvals.deleted');
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'settings.approvals.delete_failed'),
    });
  }
}
