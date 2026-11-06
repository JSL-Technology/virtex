import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AiService } from '../data/ai.service';
import { AgentsApiService } from '../agents/agents.service';
import { AiActivityPage } from './ai-activity.page';

/** What the AI did — moved out of Settings, where it mixed operation with configuration (ARQ-01). */
describe('AiActivityPage', () => {
  let fixture: ComponentFixture<AiActivityPage>;
  let ai: Record<string, jest.Mock>;
  let agents: Record<string, jest.Mock>;

  const run = { status: 'SUCCEEDED', createdAt: '2026-10-18T07:00:00Z', startedAt: null, finishedAt: null, error: null, series: 12, medianWape: 0.2, findings: null, engineVersion: '1' };
  const overview = {
    runs: { forecast: { latest: run, lastSucceeded: run }, anomaly: { latest: null, lastSucceeded: null } },
    pending: { stockoutRisks: 2, openAnomalies: 1, seriousAnomalies: 0 },
  };

  async function create() {
    ai = {
      overview: jest.fn().mockReturnValue(of(overview)),
      runForecast: jest.fn().mockReturnValue(of({})),
      runAnomalies: jest.fn().mockReturnValue(of({})),
    };
    agents = {
      runs: jest.fn().mockReturnValue(of([])),
      copilotProposals: jest.fn().mockReturnValue(of([])),
      copilotFeedback: jest.fn().mockReturnValue(of({ last30Days: { up: 0, down: 0, reported: 0 }, items: [] })),
      runReplenishment: jest.fn().mockReturnValue(of({ runId: 'r', orders: [] })),
    };
    await TestBed.configureTestingModule({
      imports: [AiActivityPage],
      providers: [
        provideRouter([]),
        { provide: AiService, useValue: ai },
        { provide: AgentsApiService, useValue: agents },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showSuccess: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/acme${path}` } },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['procurement:manage', 'ai_forecasts:run']), hasPermissions: () => true } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AiActivityPage);
    fixture.detectChanges();
  }

  afterEach(() => fixture.destroy());

  it('reads the engine runs and the agents’ log', async () => {
    await create();
    expect(fixture.componentInstance.overviewState()).toBe('ready');
    expect(fixture.componentInstance.logState()).toBe('ready');
    expect(fixture.componentInstance.runOf('forecast').latest?.status).toBe('SUCCEEDED');
  });

  it('runs the replenishment agent on request and reloads the log', async () => {
    await create();
    fixture.componentInstance.runAgent();
    expect(agents['runReplenishment']).toHaveBeenCalled();
    expect(agents['runs']).toHaveBeenCalledTimes(2);
  });

  it('says the log could not be read, and reads it again on retry', async () => {
    await create();
    agents['runs'].mockReturnValueOnce(throwError(() => ({ status: 500 })));
    fixture.componentInstance.loadLog();
    expect(fixture.componentInstance.logState()).toBe('error');
    fixture.componentInstance.loadLog();
    expect(fixture.componentInstance.logState()).toBe('ready');
  });
});
