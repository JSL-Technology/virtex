import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { FORMAT_PIPES, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { SettingsShellService } from '../../settings/shell/settings-shell.service';
import { AiPolicy, AiPolicyChange, AiPolicyService } from './ai-policy.service';

/**
 * Admin › AI › What the company allows: whether anything is sent to a model provider, feature by
 * feature, what is sent unasked (the monthly report, product photos), the spending budget, how long
 * conversations are kept and whether identifiers are masked. Everything here can be switched off and
 * the product keeps working by hand; a change is saved at once and audited by the server.
 *
 * Read by whoever reads the AI usage; changed only with `ai_settings:manage`.
 */
@Component({
  selector: 'app-ai-policy-panel',
  standalone: true,
  imports: [VxNumberInputDirective, FormsModule, TranslatePipe, ...FORMAT_PIPES, ...VX_FORM_A11Y],
  templateUrl: './ai-policy-panel.component.html',
  styleUrl: './ai-policy-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiPolicyPanelComponent implements OnInit {
  private readonly api = inject(AiPolicyService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  /** Inside Settings: the header says this panel saves on its own, and when it last did. */
  private readonly shell = inject(SettingsShellService, { optional: true });
  protected readonly k = composeKey;

  readonly policy = signal<AiPolicy | null>(null);
  readonly saving = signal(false);
  readonly canManage = computed(() => this.auth.hasPermissions(['ai_settings:manage']));

  /** Share of the month's budget spent, 0–100. */
  readonly spentShare = computed(() => {
    const policy = this.policy();
    if (!policy || policy.settings.monthlyBudgetUsd <= 0) return null;
    return Math.min(100, Math.round((policy.spend.monthUsd / policy.settings.monthlyBudgetUsd) * 100));
  });

  ngOnInit(): void {
    if (this.canManage()) this.shell?.autosaves.set(true);
    this.load();
  }

  private load(): void {
    this.api.get().subscribe({ next: (policy) => this.policy.set(policy), error: () => this.policy.set(null) });
  }

  featureEnabled(feature: string): boolean {
    return !(this.policy()?.settings.disabledFeatures ?? []).includes(feature);
  }

  toggleFeature(feature: string, enabled: boolean): void {
    const current = new Set(this.policy()?.settings.disabledFeatures ?? []);
    if (enabled) current.delete(feature);
    else current.add(feature);
    this.save({ disabledFeatures: [...current] });
  }

  /** An empty box returns the company to the platform default (monthly) or to no limit (daily). */
  setBudget(kind: 'monthlyBudgetUsd' | 'dailyBudgetUsd', value: string | number | null): void {
    const amount = Number(value);
    this.save({ [kind]: value === '' || value === null || !(amount >= 0) ? null : Math.round(amount * 100) / 100 });
  }

  setRetention(value: string | number | null): void {
    const days = Math.round(Number(value));
    if (!(days >= 1 && days <= 3650)) return;
    this.save({ conversationRetentionDays: days });
  }

  /**
   * A change that starts sending the company's data to a model provider, or stops masking it, is
   * asked for first: it was applied by a single click with nothing saying what it meant (CG-19).
   * Turning sending off, or masking on, is never asked — the safe direction needs no friction.
   */
  async saveSensitive(change: AiPolicyChange, input?: HTMLInputElement): Promise<void> {
    const startsSending = (['languageModels', 'scheduledReports', 'imageEmbeddings'] as const).some((key) => change[key] === true);
    const stopsMasking = change.maskIdentifiers === false;
    if (startsSending || stopsMasking) {
      const confirmed = await this.dialog.confirm({
        title: 'ai.policy.confirm_title',
        message: stopsMasking ? 'ai.policy.confirm_unmask' : 'ai.policy.confirm_send',
        confirmText: 'ai.policy.confirm_action',
        variant: 'warning',
      });
      if (!confirmed) {
        // The checkbox already moved; put it back where the policy is.
        if (input) input.checked = !input.checked;
        return;
      }
    }
    this.save(change);
  }

  save(change: AiPolicyChange): void {
    if (!this.canManage()) return;
    this.saving.set(true);
    this.api.update(change).subscribe({
      next: (policy) => {
        this.policy.set(policy);
        this.saving.set(false);
        this.shell?.markAutosaved();
      },
      error: (error) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'ai.policy.save_failed');
        // Reload so the screen shows what is actually in effect, not the refused change.
        this.load();
      },
    });
  }
}
