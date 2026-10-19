import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { AiOverview, AiRunSummary, AiService } from '../../../ai/data/ai.service';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../../core/services/notification';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { AiAgentsPanelComponent } from '../../../ai/agents/agents-panel.component';

type Availability = 'available' | 'not_in_plan' | 'provider_missing';

interface FeatureUsage {
  feature: string;
  calls: number;
  failed: number;
  credits: number;
  costUsd: number;
}

/**
 * Administration › AI: what the AI is doing for this company and what it costs.
 *
 * One screen for the questions an administrator asks: which features work and, when one does
 * not, whether it is the plan or the server; how many of the plan's credits are gone; what each
 * feature cost this month (an estimate from list prices, recorded with every call); how the last
 * forecasting and anomaly runs went, with their measured accuracy; and what is waiting for
 * someone. Everything is read from `GET /ai/overview`; nothing here changes a setting.
 */
@Component({
  selector: 'app-ai-settings-page',
  standalone: true,
  imports: [TranslateModule, RouterLink, HasPermissionDirective, ...FORMAT_PIPES, AiAgentsPanelComponent],
  templateUrl: './ai-settings.page.html',
  styleUrls: ['./ai-settings.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsPage implements OnInit {
  private readonly ai = inject(AiService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);

  readonly overview = signal<AiOverview | null>(null);
  readonly loadError = signal(false);
  readonly starting = signal<'forecast' | 'anomaly' | null>(null);

  protected readonly k = composeKey;
  protected readonly predictionsLink = computed(() => this.organization.urlFor('/inventory/predictions'));
  protected readonly anomaliesLink = computed(() => this.organization.urlFor('/reports/anomalies'));

  /** Each feature, and in one word why it is or is not available. */
  readonly features = computed(() => {
    const status = this.overview()?.status;
    if (!status) return [];
    const why = (plan: boolean, available: boolean): Availability =>
      !plan ? 'not_in_plan' : available ? 'available' : 'provider_missing';
    return [
      { key: 'vision', state: why(status.vision.enabledByPlan, status.vision.available) },
      { key: 'forecasting', state: why(status.forecasting.enabledByPlan, status.forecasting.available) },
      { key: 'anomalies', state: why(status.anomalies.enabledByPlan, status.anomalies.available) },
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

  run(kind: 'forecast' | 'anomaly'): void {
    this.starting.set(kind);
    const request = kind === 'forecast' ? this.ai.runForecast() : this.ai.runAnomalies();
    request.subscribe({
      next: () => {
        this.starting.set(null);
        this.notifications.showSuccess('ai.admin.run_queued');
        this.load();
      },
      error: (err) => {
        this.starting.set(null);
        this.notifications.showHttpError(err, 'ai.admin.run_failed');
      },
    });
  }

  runOf(kind: 'forecast' | 'anomaly'): { latest: AiRunSummary | null; lastSucceeded: AiRunSummary | null } {
    return this.overview()?.runs[kind] ?? { latest: null, lastSucceeded: null };
  }

  isActive(run: AiRunSummary | null): boolean {
    return run?.status === 'QUEUED' || run?.status === 'RUNNING';
  }
}
