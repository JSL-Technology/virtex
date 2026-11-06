import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';
import { VxErrorStateComponent, VxSpinnerComponent } from '../../../shared/components/feedback';
import { SettingsGroupComponent } from '../../settings/shared';
import { SettingsChanges, SettingsShellService } from '../../settings/shell';
import { AgentsApiService, ReplenishmentSettings } from './agents.service';

type Draft = Pick<ReplenishmentSettings, 'enabled' | 'submitForApproval' | 'maxOrderAmount'>;

/**
 * Admin › AI › Agents: how each agent is allowed to work — today, the replenishment agent: whether
 * it runs, whether its orders go to approval, and up to what amount.
 *
 * Configuration only. What the agents did, what the assistant proposed and how people rated it is
 * operation, and lives in «Actividad de la IA» (Analysis), with the button to run an agent now: the
 * settings window used to carry three screens of that log under the policy (ARQ-01).
 *
 * An agent never commits the company: it writes drafts, or sends them into the approval flow the
 * company already has. Its settings are saved with the window's save bar, like every other form.
 */
@Component({
  selector: 'app-ai-agents-panel',
  standalone: true,
  imports: [TranslatePipe, SettingsGroupComponent, VxErrorStateComponent, VxSpinnerComponent],
  templateUrl: './agents-panel.component.html',
  styleUrl: './agents-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAgentsPanelComponent implements OnInit {
  private readonly api = inject(AgentsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly settings = signal<ReplenishmentSettings | null>(null);
  readonly draft = signal<Draft | null>(null);
  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly saving = signal(false);
  readonly canManage = computed(() => (this.shell ? this.shell.canEdit() : this.auth.hasPermissions(['ai_settings:manage'])));

  readonly dirty = computed(() => {
    const settings = this.settings();
    const draft = this.draft();
    return (
      !!settings &&
      !!draft &&
      (draft.enabled !== settings.enabled || draft.submitForApproval !== settings.submitForApproval || draft.maxOrderAmount !== settings.maxOrderAmount)
    );
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
    this.api.replenishmentSettings().subscribe({
      next: (settings) => {
        this.apply(settings);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  patch(change: Partial<Draft>): void {
    if (this.canManage()) this.draft.update((draft) => (draft ? { ...draft, ...change } : draft));
  }

  /** An empty box, or zero, means no limit. */
  setLimit(value: string | number | null): void {
    const amount = Number(value);
    this.patch({ maxOrderAmount: value === '' || value === null || !(amount > 0) ? null : amount });
  }

  discard(): void {
    const settings = this.settings();
    if (settings) this.apply(settings);
  }

  save(): Promise<boolean> {
    const draft = this.draft();
    if (!this.canManage() || !this.dirty() || !draft) return Promise.resolve(false);
    this.saving.set(true);
    return new Promise((resolve) => {
      this.api.updateReplenishment(draft).subscribe({
        next: (settings) => {
          this.saving.set(false);
          this.apply(settings);
          this.notifications.showSuccess('ai.agents.saved');
          resolve(true);
        },
        error: (error) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'ai.agents.save_failed');
          resolve(false);
        },
      });
    });
  }

  private apply(settings: ReplenishmentSettings): void {
    this.settings.set(settings);
    this.draft.set({ enabled: settings.enabled, submitForApproval: settings.submitForApproval, maxOrderAmount: settings.maxOrderAmount });
  }
}
