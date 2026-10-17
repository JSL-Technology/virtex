import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AnomaliesPage } from './anomalies.page';
import { AiService, Anomaly } from '../data/ai.service';
import { NotificationService } from '../../../core/services/notification';

const anomaly = (overrides: Partial<Anomaly> = {}): Anomaly => ({
  id: 'a1',
  detector: 'rule.duplicate_vendor_bill',
  category: 'purchases',
  severity: 'HIGH',
  score: 1,
  entityType: 'vendor_bill',
  entityId: 'b1',
  branchId: null,
  occurredOn: '2026-10-01',
  evidence: { fiscalNumber: 'B0100000001', total: 100, count: 2, reason: 'same_fiscal_number', billIds: ['b1', 'b2'] },
  explanation: null,
  status: 'OPEN',
  resolvedAt: null,
  createdAt: '2026-10-02T02:20:00Z',
  ...overrides,
});

describe('AnomaliesPage', () => {
  let fixture: ComponentFixture<AnomaliesPage>;
  let component: AnomaliesPage;
  let ai: Record<string, jest.Mock>;

  beforeEach(async () => {
    ai = {
      status: jest.fn().mockReturnValue(of({ anomalies: { explanations: true } })),
      anomalies: jest.fn().mockReturnValue(of({ total: 1, items: [anomaly()], byStatus: { OPEN: 1 } })),
      lastAnomalyRun: jest.fn().mockReturnValue(of(null)),
      feedback: jest.fn().mockReturnValue(of(anomaly({ status: 'DISMISSED' }))),
      explain: jest.fn().mockReturnValue(of(anomaly({ explanation: 'Se registró dos veces la misma factura.' }))),
      reopen: jest.fn().mockReturnValue(of(anomaly())),
      runAnomalies: jest.fn().mockReturnValue(of({ id: 'r', status: 'QUEUED', createdAt: '' })),
    };
    await TestBed.configureTestingModule({
      imports: [AnomaliesPage],
      providers: [
        { provide: AiService, useValue: ai },
        {
          provide: NotificationService,
          useValue: { showInfo: jest.fn(), showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: () => 'x' },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AnomaliesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens on what is still pending', () => {
    expect(ai['anomalies']).toHaveBeenCalledWith(expect.objectContaining({ status: 'OPEN' }));
    expect(component.rows()).toHaveLength(1);
  });

  it('shows the evidence a reviewer needs, in order, and nothing internal', () => {
    expect(component.evidenceOf(anomaly()).map((f) => f.key)).toEqual(['fiscalNumber', 'total', 'count', 'reason']);
  });

  it('records a verdict and refreshes the inbox', () => {
    component.verdict(anomaly(), 'FALSE_POSITIVE');
    expect(ai['feedback']).toHaveBeenCalledWith('a1', 'FALSE_POSITIVE');
    expect(ai['anomalies']).toHaveBeenCalledTimes(2);
  });

  it('puts the explanation on the finding it explains', () => {
    component.explain(anomaly());
    expect(component.rows()[0].explanation).toContain('dos veces');
  });

  it('offers explanations only when the server can write them', () => {
    expect(component.canExplain()).toBe(true);
  });
});
