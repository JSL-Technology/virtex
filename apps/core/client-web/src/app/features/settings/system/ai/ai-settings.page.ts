import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, FORMAT_PIPES, FormatService } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { BarChart3 } from 'lucide-angular';
import { AiOverview, AiService } from '../../../ai/data/ai.service';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { AiAgentsPanelComponent } from '../../../ai/agents/agents-panel.component';
import { AiPolicyPanelComponent } from '../../../ai/policy/ai-policy-panel.component';
import { VxBadgeComponent, type VxTone } from '../../../../shared/components/badge';
import { VxEmptyStateComponent, VxErrorStateComponent, VxSpinnerComponent } from '../../../../shared/components/feedback';
import { SettingsGroupComponent } from '../../shared';
import { SettingsSaveBarComponent, SettingsShellService } from '../../shell';

type Availability = 'available' | 'not_in_plan' | 'provider_missing' | 'engine_offline';

interface FeatureUsage {
  feature: string;
  calls: number;
  failed: number;
  credits: number;
  costUsd: number;
}

/**
 * Settings › Artificial intelligence: what the company allows the AI, what it may spend, and what
 * is available.
 *
 * The policy and the agents are forms, saved together with one save bar, like every form of the
 * window (they saved each field on blur, and an edit closed with Escape was lost). Availability
 * says in one word why a feature works or not — the plan or the server. Consumption shows the
 * plan's credits and each feature's estimated cost, in the window's one money format.
 *
 * What the AI *did* — engine runs, the agents' log, the assistant's proposals, ratings — is
 * operation, and lives in «Actividad de la IA» (Analysis); this page links there (ARQ-01).
 */
@Component({
  selector: 'app-ai-settings-page',
  standalone: true,
  imports: [
    TranslateModule,
    RouterLink,
    AiAgentsPanelComponent,
    AiPolicyPanelComponent,
    SettingsGroupComponent,
    SettingsSaveBarComponent,
    VxBadgeComponent,
    VxEmptyStateComponent,
    VxErrorStateComponent,
    VxSpinnerComponent,
    ...FORMAT_PIPES,
  ],
  templateUrl: './ai-settings.page.html',
  styleUrls: ['./ai-settings.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsPage implements OnInit {
  private readonly ai = inject(AiService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly format = inject(FormatService);
  private readonly shell = inject(SettingsShellService, { optional: true });

  private readonly policy = viewChild<AiPolicyPanelComponent>('policy');
  private readonly agents = viewChild<AiAgentsPanelComponent>('agents');

  protected readonly ChartIcon = BarChart3;
  protected readonly k = composeKey;
  protected readonly activityLink = computed(() => this.organization.urlFor('/reports/ai-activity'));

  readonly overview = signal<AiOverview | null>(null);
  readonly loadError = signal(false);

  readonly canEdit = computed(() => this.shell?.canEdit() ?? true);
  /** The two forms, as one: dirty, saving or blocked when either is. */
  readonly dirty = computed(() => Boolean(this.policy()?.dirty() || this.agents()?.dirty()));
  readonly saving = computed(() => Boolean(this.policy()?.saving() || this.agents()?.saving()));
  readonly blocked = computed(() => this.policy()?.blocked() ?? null);

  /** Each feature, and in one word why it is or is not available. */
  readonly features = computed(() => {
    const status = this.overview()?.status;
    if (!status) return [];
    const why = (plan: boolean, available: boolean): Availability =>
      !plan ? 'not_in_plan' : available ? 'available' : 'provider_missing';
    // Forecasts and anomalies come from the analytics engine, not the language model: when they
    // are unavailable, the reason is that the engine is stopped (QA R3-M08).
    const byEngine = (plan: boolean, available: boolean): Availability =>
      !plan ? 'not_in_plan' : available ? 'available' : status.engine?.online === false ? 'engine_offline' : 'provider_missing';
    return [
      { key: 'vision', state: why(status.vision.enabledByPlan, status.vision.available) },
      { key: 'forecasting', state: byEngine(status.forecasting.enabledByPlan, status.forecasting.available) },
      { key: 'anomalies', state: byEngine(status.anomalies.enabledByPlan, status.anomalies.available) },
      {
        key: 'explanations',
        state: why(status.anomalies.enabledByPlan, status.anomalies.explanations),
      },
    ];
  });

  /** The month's use folded by feature: what it was used for, how often it failed, what it cost. */
  readonly usage = computed<FeatureUsage[]>(() => {
    const byFeature = new Map<string, FeatureUsage>();
    for (const row of this.overview()?.usage ?? []) {
      const entry = byFeature.get(row.feature) ?? { feature: row.feature, calls: 0, failed: 0, credits: 0, costUsd: 0 };
      entry.calls += row.calls;
      entry.credits += row.credits;
      entry.costUsd += row.costMicroUsd / 1_000_000;
      if (row.status !== 'SUCCEEDED') entry.failed += row.calls;
      byFeature.set(row.feature, entry);
    }
    return [...byFeature.values()].sort((a, b) => b.costUsd - a.costUsd);
  });

  readonly totalCostUsd = computed(() => this.usage().reduce((sum, row) => sum + row.costUsd, 0));

  /** Share of the plan's monthly credits used, 0–100; null when unlimited or unmetered. */
  readonly creditShare = computed(() => {
    const credits = this.overview()?.credits;
    if (!credits || credits.unlimited || !credits.limit) return null;
    return Math.min(100, Math.round((credits.used / credits.limit) * 100));
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadError.set(false);
    this.ai.overview().subscribe({
      next: (overview) => this.overview.set(overview),
      error: () => this.loadError.set(true),
    });
  }

  /** In the window it is the shell that saves every form with edits; alone, the two panels. */
  async save(): Promise<boolean> {
    if (this.shell) return this.shell.save();
    const results = await Promise.all([this.policy()?.save() ?? true, this.agents()?.save() ?? true]);
    return results.every(Boolean);
  }

  discard(): void {
    if (this.shell) {
      this.shell.discard();
      return;
    }
    this.policy()?.discard();
    this.agents()?.discard();
  }

  /** An estimated cost, often a fraction of a cent: the window's money format, with up to four decimals. */
  cost(value: number): string {
    return this.format.money(value, 'USD', { digits: '1.2-4' });
  }

  /** Availability by what it means: works, not in the plan, or something to fix on the server. */
  availabilityTone(state: Availability): VxTone {
    switch (state) {
      case 'available':
        return 'ok';
      case 'not_in_plan':
        return 'neutral';
      default:
        return 'warning';
    }
  }
}
