import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { of, throwError } from 'rxjs';
import { AiSettingsPage } from './ai-settings.page';
import { AiOverview, AiService } from '../../../ai/data/ai.service';
import { NotificationService } from '../../../../core/services/notification';
import { AuthService } from '../../../../core/services/auth';

const overview = (overrides: Partial<AiOverview> = {}): AiOverview => ({
  status: {
    vision: { enabledByPlan: true, available: false },
    forecasting: { enabledByPlan: true, available: true },
    anomalies: { enabledByPlan: false, available: false, explanations: false },
    duplicateImageSearch: false,
  },
  credits: { used: 460, limit: 500, unlimited: false, period: 'MONTHLY' },
  usage: [
    { feature: 'product_vision', status: 'SUCCEEDED', calls: 40, credits: 40, costMicroUsd: 1_200_000, inputTokens: 1, outputTokens: 1 },
    { feature: 'product_vision', status: 'FAILED', calls: 2, credits: 0, costMicroUsd: 0, inputTokens: 0, outputTokens: 0 },
    { feature: 'anomaly_narrative', status: 'SUCCEEDED', calls: 10, credits: 10, costMicroUsd: 3_000_000, inputTokens: 1, outputTokens: 1 },
  ],
  runs: {
    forecast: {
      latest: { id: 'r2', status: 'RUNNING', trigger: 'MANUAL', createdAt: '2026-10-13T10:00:00Z', startedAt: null, finishedAt: null, error: null, engineVersion: null, series: null, medianWape: null, findings: null },
      lastSucceeded: { id: 'r1', status: 'SUCCEEDED', trigger: 'SCHEDULED', createdAt: '2026-10-12T02:17:00Z', startedAt: null, finishedAt: '2026-10-12T02:30:00Z', error: null, engineVersion: '0.3.0', series: 812, medianWape: 0.31, findings: null },
    },
    anomaly: { latest: null, lastSucceeded: null },
  },
  pending: { seriousAnomalies: 2, openAnomalies: 9, stockoutRisks: 14 },
  ...overrides,
});

describe('AiSettingsPage', () => {
  let fixture: ComponentFixture<AiSettingsPage>;
  let page: AiSettingsPage;
  let ai: { overview: jest.Mock; runForecast: jest.Mock; runAnomalies: jest.Mock };
  let notifications: { showSuccess: jest.Mock; showHttpError: jest.Mock };

  beforeEach(async () => {
    ai = {
      overview: jest.fn().mockReturnValue(of(overview())),
      runForecast: jest.fn().mockReturnValue(of({ id: 'r3', status: 'QUEUED' })),
      runAnomalies: jest.fn().mockReturnValue(of({ id: 'r4', status: 'QUEUED' })),
    };
    notifications = { showSuccess: jest.fn(), showHttpError: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [AiSettingsPage],
      providers: [
        provideRouter([]),
        { provide: AiService, useValue: ai },
        { provide: NotificationService, useValue: notifications },
        {
          provide: AuthService,
          useValue: { hasPermissions: () => true, getPermissions$: () => of(['ai_forecasts:run', 'ai_anomalies:resolve']) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AiSettingsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('says why each feature is or is not available: the plan, or the server', () => {
    expect(page.features()).toEqual([
      { key: 'vision', state: 'provider_missing' },
      { key: 'forecasting', state: 'available' },
      { key: 'anomalies', state: 'not_in_plan' },
      { key: 'explanations', state: 'not_in_plan' },
    ]);
  });

  it('folds the month by feature, counting failures and the estimated cost', () => {
    expect(page.usage()).toEqual([
      { feature: 'anomaly_narrative', calls: 10, failed: 0, credits: 10, costUsd: 3 },
      { feature: 'product_vision', calls: 42, failed: 2, credits: 40, costUsd: 1.2 },
    ]);
    expect(page.totalCostUsd()).toBeCloseTo(4.2);
    expect(page.creditShare()).toBe(92);
  });

  it('has no meter for an unlimited plan', () => {
    page.overview.set(overview({ credits: { used: 9000, limit: null, unlimited: true, period: 'MONTHLY' } }));
    expect(page.creditShare()).toBeNull();
  });

  it('does not offer to start a run that is already running, and refreshes after starting one', () => {
    expect(page.isActive(page.runOf('forecast').latest)).toBe(true);
    page.run('anomaly');
    expect(ai.runAnomalies).toHaveBeenCalled();
    expect(notifications.showSuccess).toHaveBeenCalledWith('ai.admin.run_queued');
    expect(ai.overview).toHaveBeenCalledTimes(2);
  });

  it('offers a retry when the overview cannot be loaded', () => {
    ai.overview.mockReturnValue(throwError(() => ({ status: 500 })));
    page.load();
    fixture.detectChanges();
    expect(page.loadError()).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="alert"] button')).not.toBeNull();
  });
});
