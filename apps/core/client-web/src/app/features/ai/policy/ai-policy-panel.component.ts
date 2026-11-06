import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { FORMAT_PIPES, FormatService } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { VxErrorStateComponent, VxSpinnerComponent } from '../../../shared/components/feedback';
import { SettingsGroupComponent } from '../../settings/shared';
import { SettingsChanges, SettingsShellService } from '../../settings/shell';
import { AiPolicy, AiPolicyChange, AiPolicyService, AiPolicySettings } from './ai-policy.service';

/** The editable part of the policy, as the form holds it until «Guardar». */
export interface AiPolicyDraft {
  languageModels: boolean;
  disabledFeatures: string[];
  scheduledReports: boolean;
  imageEmbeddings: boolean;
  maskIdentifiers: boolean;
  activityMonitoring: boolean;
  /** Null: the platform's default. */
  monthlyBudgetUsd: number | null;
  /** Null: no daily limit. */
  dailyBudgetUsd: number | null;
  conversationRetentionDays: number | null;
}

const SWITCHES = ['languageModels', 'scheduledReports', 'imageEmbeddings', 'maskIdentifiers', 'activityMonitoring'] as const;
const SENDING = ['languageModels', 'scheduledReports', 'imageEmbeddings'] as const;

/**
 * Admin › AI › What the company allows: whether anything is sent to a model provider, feature by
 * feature, what is sent unasked (the monthly report, product photos), the spending budget, how long
 * conversations are kept and whether identifiers are masked. Everything here can be switched off and
 * the product keeps working by hand.
 *
 * It is a form of the settings window like the others: the edits are held until «Guardar» in the
 * save bar, and the window asks before closing with them pending. It used to save each field when
 * it lost focus, so a budget typed and closed with Escape was lost without a word (GUA-01, GUA-02).
 * A change that starts sending data or stops masking it is still asked for first, now at the save.
 *
 * Read by whoever reads the AI usage; changed only with `ai_settings:manage`.
 */
@Component({
  selector: 'app-ai-policy-panel',
  standalone: true,
  imports: [TranslatePipe, SettingsGroupComponent, VxErrorStateComponent, VxSpinnerComponent, ...FORMAT_PIPES],
  templateUrl: './ai-policy-panel.component.html',
  styleUrl: './ai-policy-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiPolicyPanelComponent implements OnInit {
  private readonly api = inject(AiPolicyService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly format = inject(FormatService);
  protected readonly k = composeKey;

  readonly policy = signal<AiPolicy | null>(null);
  readonly draft = signal<AiPolicyDraft | null>(null);
  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly saving = signal(false);
  /** Inside the settings window it follows the section's edit permission; alone, the permission itself. */
  readonly canManage = computed(() => (this.shell ? this.shell.canEdit() : this.auth.hasPermissions(['ai_settings:manage'])));

  /** Share of the month's budget spent, 0–100. */
  readonly spentShare = computed(() => {
    const policy = this.policy();
    if (!policy || policy.settings.monthlyBudgetUsd <= 0) return null;
    return Math.min(100, Math.round((policy.spend.monthUsd / policy.settings.monthlyBudgetUsd) * 100));
  });

  /** What the form changes against what is in effect, in the shape the server takes. */
  readonly change = computed<AiPolicyChange>(() => {
    const policy = this.policy();
    const draft = this.draft();
    if (!policy || !draft) return {};
    const saved = toDraft(policy.settings);
    const change: AiPolicyChange = {};
    for (const key of SWITCHES) if (draft[key] !== saved[key]) change[key] = draft[key];
    if ([...draft.disabledFeatures].sort().join() !== [...saved.disabledFeatures].sort().join()) change.disabledFeatures = [...draft.disabledFeatures];
    if (draft.monthlyBudgetUsd !== saved.monthlyBudgetUsd) change.monthlyBudgetUsd = draft.monthlyBudgetUsd;
    if (draft.dailyBudgetUsd !== saved.dailyBudgetUsd) change.dailyBudgetUsd = draft.dailyBudgetUsd;
    if (draft.conversationRetentionDays !== saved.conversationRetentionDays && draft.conversationRetentionDays !== null) {
      change.conversationRetentionDays = draft.conversationRetentionDays;
    }
    return change;
  });

  readonly dirty = computed(() => {
    const draft = this.draft();
    const policy = this.policy();
    if (!draft || !policy) return false;
    return Object.keys(this.change()).length > 0 || draft.conversationRetentionDays !== policy.settings.conversationRetentionDays;
  });

  /** Why it cannot be saved yet, named in the save bar instead of a value silently dropped (GUA-03). */
  readonly blocked = computed<{ key: string; params: Record<string, unknown> } | null>(() => {
    const draft = this.draft();
    const policy = this.policy();
    if (!draft || !policy) return null;
    const days = draft.conversationRetentionDays;
    if (days === null || !(days >= 1 && days <= 3650)) return { key: 'ai.policy.retention_invalid', params: {} };
    if (draft.monthlyBudgetUsd !== null && draft.monthlyBudgetUsd > policy.settings.maxMonthlyBudgetUsd) {
      return { key: 'ai.policy.budget_over_max', params: { max: this.format.money(policy.settings.maxMonthlyBudgetUsd, 'USD') } };
    }
    return null;
  });

  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.save(),
    discard: () => this.discard(),
  };

  ngOnInit(): void {
    if (this.shell) {
      this.shell.register(this.changes);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.changes));
    }
    this.load();
  }

  load(): void {
    this.state.set('loading');
    this.api.get().subscribe({
      next: (policy) => {
        this.apply(policy);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  patch(change: Partial<AiPolicyDraft>): void {
    if (!this.canManage()) return;
    this.draft.update((draft) => (draft ? { ...draft, ...change } : draft));
  }

  featureEnabled(feature: string): boolean {
    return !(this.draft()?.disabledFeatures ?? []).includes(feature);
  }

  toggleFeature(feature: string, enabled: boolean): void {
    const current = new Set(this.draft()?.disabledFeatures ?? []);
    if (enabled) current.delete(feature);
    else current.add(feature);
    this.patch({ disabledFeatures: [...current] });
  }

  /** An empty box returns the company to the platform default (monthly) or to no limit (daily). */
  setBudget(kind: 'monthlyBudgetUsd' | 'dailyBudgetUsd', value: string | number | null): void {
    const amount = Number(value);
    this.patch({ [kind]: value === '' || value === null || !(amount >= 0) ? null : Math.round(amount * 100) / 100 });
  }

  setRetention(value: string | number | null): void {
    this.patch({ conversationRetentionDays: value === '' || value === null ? null : Math.round(Number(value)) });
  }

  discard(): void {
    const policy = this.policy();
    if (policy) this.draft.set(toDraft(policy.settings));
  }

  /**
   * Sends what changed. A change that starts sending the company's data to a model provider, or
   * stops masking it, is asked for first (CG-19); the safe direction needs no friction. Declining
   * keeps the edits in the form, unsaved.
   */
  async save(): Promise<boolean> {
    const change = this.change();
    if (!this.canManage() || !this.dirty() || this.blocked() || !Object.keys(change).length) return false;
    const startsSending = SENDING.some((key) => change[key] === true);
    const stopsMasking = change.maskIdentifiers === false;
    if (startsSending || stopsMasking) {
      const confirmed = await this.dialog.confirm({
        title: 'ai.policy.confirm_title',
        message: startsSending && stopsMasking ? 'ai.policy.confirm_send_unmask' : stopsMasking ? 'ai.policy.confirm_unmask' : 'ai.policy.confirm_send',
        confirmText: 'ai.policy.confirm_action',
        variant: 'warning',
      });
      if (!confirmed) return false;
    }
    this.saving.set(true);
    return new Promise((resolve) => {
      this.api.update(change).subscribe({
        next: (policy) => {
          this.saving.set(false);
          this.apply(policy);
          this.notifications.showSuccess('ai.policy.saved');
          resolve(true);
        },
        error: (error) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'ai.policy.save_failed');
          resolve(false);
        },
      });
    });
  }

  private apply(policy: AiPolicy): void {
    this.policy.set(policy);
    this.draft.set(toDraft(policy.settings));
  }
}

function toDraft(settings: AiPolicySettings): AiPolicyDraft {
  return {
    languageModels: settings.languageModels,
    disabledFeatures: [...settings.disabledFeatures],
    scheduledReports: settings.scheduledReports,
    imageEmbeddings: settings.imageEmbeddings,
    maskIdentifiers: settings.maskIdentifiers,
    activityMonitoring: settings.activityMonitoring,
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
    dailyBudgetUsd: settings.dailyBudgetUsd,
    conversationRetentionDays: settings.conversationRetentionDays,
  };
}
