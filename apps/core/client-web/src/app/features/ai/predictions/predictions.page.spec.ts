import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PredictionsPage } from './predictions.page';
import { AiService, InventoryInsight } from '../data/ai.service';
import { WarehousesService } from '../../masters/data/warehouses.service';
import { NotificationService } from '../../../core/services/notification';

const row = (overrides: Partial<InventoryInsight> = {}): InventoryInsight => ({
  productId: 'p1',
  productName: 'Café',
  sku: 'CAF-1',
  warehouseId: 'w1',
  warehouseName: 'Central',
  branchId: 'b1',
  branchName: 'Santo Domingo',
  onHand: 35,
  avgDailyDemand: 10,
  forecast30d: 300,
  forecast30dP90: 340,
  daysOfCover: 3.5,
  stockoutDate: '2026-10-17',
  leadTimeDays: 5,
  safetyStock: 7.4,
  reorderPoint: 57.4,
  suggestedOrderQty: 142,
  serviceLevel: 0.95,
  status: 'STOCKOUT_RISK',
  branchRank: 1,
  model: 'AutoETS+LightGBM',
  accuracyWape: 0.21,
  censoredDays: 2,
  ...overrides,
});

describe('PredictionsPage', () => {
  let fixture: ComponentFixture<PredictionsPage>;
  let component: PredictionsPage;
  let ai: Record<string, jest.Mock>;

  beforeEach(async () => {
    ai = {
      insights: jest.fn().mockReturnValue(of({ total: 1, items: [row()] })),
      forecastSummary: jest.fn().mockReturnValue(
        of({
          byStatus: { STOCKOUT_RISK: 1, OK: 4 },
          lastRun: { id: 'r1', status: 'SUCCEEDED', createdAt: '2026-10-13T02:17:00Z' },
          lastSuccess: { id: 'r1', finishedAt: '2026-10-13T02:20:00Z', metrics: { medianWape: 0.25 }, engineVersion: '1.0.0' },
        }),
      ),
      topByBranch: jest.fn().mockReturnValue(
        of([
          { branchId: 'b1', branchName: 'Santo Domingo', productId: 'p1', productName: 'Café', sku: null, forecast30d: 300, onHand: 35, rank: 1 },
          { branchId: 'b2', branchName: 'Santiago', productId: 'p2', productName: 'Azúcar', sku: null, forecast30d: 120, onHand: 80, rank: 1 },
        ]),
      ),
      supplierLeadTimes: jest.fn().mockReturnValue(
        of([{ supplierId: 's1', supplierName: 'Induban', receipts: 12, medianDays: 6, p90Days: 11, minDays: 3, maxDays: 14, onTimeRate: 0.75, lastReceivedAt: '2026-10-01T00:00:00Z' }]),
      ),
      series: jest.fn().mockReturnValue(of({ history: [{ date: '2026-10-01', quantity: 9 }], forecast: [{ date: '2026-10-14', p10: 6, p50: 10, p90: 14, model: 'AutoETS' }] })),
      runForecast: jest.fn().mockReturnValue(of({ id: 'r2', status: 'QUEUED', createdAt: '' })),
    };
    await TestBed.configureTestingModule({
      imports: [PredictionsPage],
      providers: [
        { provide: AiService, useValue: ai },
        { provide: WarehousesService, useValue: { list: () => of([]) } },
        { provide: NotificationService, useValue: { showInfo: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: () => 'x' } },
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PredictionsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens on the risks first', () => {
    expect(ai['insights']).toHaveBeenCalledWith(expect.objectContaining({ sort: 'risk', offset: 0 }));
    expect(component.rows()).toHaveLength(1);
    expect(component.medianWape()).toBe(0.25);
  });

  it('groups the best sellers by branch', () => {
    expect(component.branches().map((b) => b.name)).toEqual(['Santo Domingo', 'Santiago']);
  });

  it('shows the measured lead time of each supplier', () => {
    expect(component.leadTimes()).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.pred-leadtimes')?.textContent).toContain('Induban');
  });

  it('filters by a status chip, and a second click clears it', () => {
    component.filterStatus('REORDER');
    expect(ai['insights']).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'REORDER' }));
    component.filterStatus('REORDER');
    expect(ai['insights']).toHaveBeenLastCalledWith(expect.objectContaining({ status: '' }));
  });

  it('loads the chart of a row when it is expanded', () => {
    component.toggle(row());
    expect(ai['series']).toHaveBeenCalledWith('p1', 'w1');
    expect(component.series()?.forecast).toHaveLength(1);
    component.toggle(row());
    expect(component.expanded()).toBeNull();
  });

  it('queues a run on demand', () => {
    component.runNow();
    expect(ai['runForecast']).toHaveBeenCalled();
  });
});
