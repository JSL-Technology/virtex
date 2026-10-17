import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CashflowPage } from './cashflow.page';
import { CashflowService, CashflowOverview } from './cashflow.service';
import { NotificationService } from '../../../core/services/notification';

const overview = (shortfall: number): CashflowOverview => ({
  latest: { id: 'r1', kind: 'CASHFLOW', status: 'SUCCEEDED', createdAt: '', finishedAt: '2026-10-17T02:30:00Z', error: null },
  projection: {
    runId: 'r1', createdAt: '', finishedAt: '2026-10-17T02:30:00Z', baseCurrency: 'DOP', asOfDate: '2026-10-17',
    metrics: {
      openingCash: 100000, threshold: 0, horizonDays: 90, endP10: 5000, endP50: 60000, endP90: 90000,
      lowestP50: 12000, lowestP50Date: '2026-11-14', lowestP10: -8000, shortfallProbability: shortfall,
      firstLikelyShortfallDate: shortfall ? '2026-11-10' : null, expectedInflow: 200000, expectedOutflow: 240000,
      byComponent: { receivables: 150000, payables: -90000 },
      drivers: [{ kind: 'RECEIVABLE', documentId: 'd1', partyName: 'Tardío SRL', amount: 48000, dueDate: '2026-10-20', pBy30: 0.2, doubtful: false }],
    },
    days: [{ day: '2026-10-17', p10: 100000, p50: 100000, p90: 100000, inflow: 0, outflow: 0, components: {} }],
  },
});

describe('CashflowPage', () => {
  let fixture: ComponentFixture<CashflowPage>;
  let api: Record<string, jest.Mock>;

  const setup = async (data: CashflowOverview) => {
    api = {
      overview: jest.fn().mockReturnValue(of(data)),
      documents: jest.fn().mockReturnValue(of({ total: 0, items: [] })),
      plan: jest.fn().mockReturnValue(of(null)),
      refresh: jest.fn().mockReturnValue(of({ id: 'r2', kind: 'CASHFLOW', status: 'QUEUED', createdAt: '', finishedAt: null, error: null })),
      runScenario: jest.fn().mockReturnValue(of({ id: 's1', kind: 'SCENARIO', status: 'QUEUED', createdAt: '', finishedAt: null, error: null })),
      scenario: jest.fn(),
      requestPlan: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [CashflowPage],
      providers: [
        { provide: CashflowService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showError: jest.fn(), httpErrorMessage: () => 'x' } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CashflowPage);
    fixture.detectChanges();
  };

  afterEach(() => fixture?.destroy());

  it('marks a real chance of a shortfall as high risk and lists what decides it', async () => {
    await setup(overview(0.4));
    expect(fixture.componentInstance.risk()).toBe('high');
    expect(fixture.nativeElement.textContent).toContain('Tardío SRL');
    expect(api['documents']).toHaveBeenCalledWith('RECEIVABLE', 'risk', 25);
  });

  it('sends the sales change as a fraction, and keeps the projection while the scenario runs', async () => {
    await setup(overview(0));
    fixture.componentInstance.updateScenario('salesChange', -20);
    fixture.componentInstance.runScenario();
    expect(api['runScenario']).toHaveBeenCalledWith(expect.objectContaining({ salesChange: -0.2 }), 0);
    expect(fixture.componentInstance.projection()?.runId).toBe('r1');
  });

  it('a recalculation keeps showing the last projection until the new one is ready', async () => {
    await setup(overview(0));
    fixture.componentInstance.refresh();
    expect(fixture.componentInstance.runInProgress()).toBe(true);
    expect(fixture.componentInstance.projection()?.runId).toBe('r1');
  });
});
