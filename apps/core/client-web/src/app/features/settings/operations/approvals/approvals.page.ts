import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxEmptyStateComponent, VxErrorStateComponent, VxNoticeComponent, VxSpinnerComponent } from '../../../../shared/components/feedback';
import { SettingsActionsDirective, SettingsChanges, SettingsShellService } from '../../shell';
import { SettingsGroupComponent } from '../../shared';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../../shared/components/context-menu';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { CheckCheck, LucideAngularModule, MoreHorizontal, Trash2 } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { roleLabel } from '../../../../shared/pipes/role-name.pipe';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { environment } from '../../../../../environments/environment';
import { NotificationService } from '../../../../core/services/notification';
import { DialogService } from '../../../../core/services/dialog.service';
import { VX_SELECT } from '../../../../shared/components/select';
import { RolesService, Role } from '../../data/roles.service';

import { VX_TABLE } from '../../../../shared/components/table';
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
  imports: [...VX_TABLE, ...VX_FORM_A11Y, 
    VxNumberInputDirective,
    VxEmptyStateComponent,
    VxErrorStateComponent,
    VxNoticeComponent,
    VxSpinnerComponent,
    SettingsActionsDirective,
    SettingsGroupComponent,
    FormsModule,
    TranslateModule,
    RouterLink,
    LucideAngularModule,
    ...VX_CONTEXT_MENU,
    ...VX_SELECT,
    ...FORMAT_PIPES,
  ],
  templateUrl: './approvals.page.html',
  styleUrls: ['./approvals.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalPoliciesPage implements OnInit {
  /** Whether this person may change the section; read-only otherwise (from the settings shell). */
  private readonly shell = inject(SettingsShellService, { optional: true });
  protected readonly canEdit = this.shell?.canEdit ?? signal(true);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly MoreIcon = MoreHorizontal;
  protected readonly ApprovalIcon = CheckCheck;
  /** Workflows: the other way to approve, named as the sidebar names it. */
  protected readonly workflowsLink = inject(ActiveOrganizationService).urlFor('/workflows');

  /** Deleting, in the shared row menu; it asks first. */
  readonly policiesMenu: ListMenuConfig<ApprovalPolicy> = {
    resource: 'approval_policies',
    row: (ctx) => {
      const policy = ctx.entity as ApprovalPolicy;
      return [
        { id: 'danger', items: [{ id: 'delete', label: 'common.delete', icon: Trash2, danger: true, visible: () => this.canEdit() && !this.draft(), run: () => this.remove(policy) }] },
      ];
    },
  };

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
  /** The draft as it was opened, to tell an edit from a look (GUA-01). */
  private readonly draftOrigin = signal<string | null>(null);
  readonly dirty = computed(() => {
    const draft = this.draft();
    return !!draft && JSON.stringify(draft) !== this.draftOrigin();
  });
  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.saveAsync(),
    discard: () => this.cancel(),
  };

  private readonly roleNames = computed(() => new Map(this.roleList().map((role) => [role.id, role.name])));

  /** One policy per document type: the types still free, for a new one. */
  readonly freeTypes = computed(() => {
    const used = new Set(this.policies().map((policy) => policy.documentType));
    return APPROVAL_DOCUMENT_TYPES.filter((type) => !used.has(type));
  });

  ngOnInit(): void {
    this.load();
    if (this.shell) {
      this.shell.register(this.changes);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.changes));
    }
  }

  /** Opens a draft, remembering how it started. */
  private openDraft(draft: PolicyDraft): void {
    this.draft.set(draft);
    this.draftOrigin.set(JSON.stringify(draft));
    queueMicrotask(() => document.getElementById('ap-name')?.focus());
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

  readonly roleLabel = (role: Role): string => roleLabel(this.translate, role.name);
  readonly roleValue = (role: Role): string => role.id;
  readonly typeLabel = (type: ApprovalDocumentType): string => this.translate.instant(this.typeKey(type));

  typeKey(type: ApprovalDocumentType): string {
    return `approvals.document_type.${type.toLowerCase()}`;
  }

  roleName(id: string): string {
    const name = this.roleNames().get(id);
    return name ? roleLabel(this.translate, name) : '—';
  }

  startNew(): void {
    const type = this.freeTypes()[0];
    if (!type) return;
    this.openDraft({ id: null, name: '', documentType: type, steps: [{ order: 1, minAmount: 0, roleId: '' }] });
  }

  edit(policy: ApprovalPolicy): void {
    this.openDraft({ id: policy.id, name: policy.name, documentType: policy.documentType, steps: policy.steps.map((s) => ({ ...s })) });
  }

  cancel(): void {
    this.draft.set(null);
    this.draftOrigin.set(null);
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

  /** The window's save: resolves true once the policy reached the server. */
  saveAsync(): Promise<boolean> {
    return new Promise((resolve) => this.save(resolve));
  }

  save(done?: (saved: boolean) => void): void {
    const draft = this.draft();
    if (!draft) {
      done?.(false);
      return;
    }
    const problem = this.problem(draft);
    if (problem) {
      this.notifications.showError(problem);
      done?.(false);
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
        this.cancel();
        this.notifications.showSuccess('settings.approvals.saved');
        this.load();
        done?.(true);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'settings.approvals.save_failed');
        done?.(false);
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
