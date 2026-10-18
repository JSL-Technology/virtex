import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { ManagerReportPage, previousPeriod } from './manager-report.page';
import { ManagerReport, ManagerReportService } from './manager-report.service';
import { NotificationService } from '../../../core/services/notification';

const report = (overrides: Partial<ManagerReport> = {}): ManagerReport => ({
  id: 'rep-1',
  kind: 'MANAGER_MONTHLY',
  period: '2026-09',
  status: 'SUCCEEDED',
  createdAt: '2026-10-01T06:41:00Z',
  finishedAt: '2026-10-01T06:43:00Z',
  error: null,
  facts: { unavailable: ['payables'] },
  content: {
    title: 'Septiembre: más ventas, menos margen',
    summary: 'Las ventas subieron y el margen bajó.',
    sections: [{ heading: 'Ventas', body: 'Ventas de 1,200,000.00.' }],
    recommendations: [{ action: 'Cobrar a Tardío SRL', why: 'Debe 48,000.00 hace 47 días.' }],
  },
  ...overrides,
});

describe('ManagerReportPage', () => {
  let fixture: ComponentFixture<ManagerReportPage>;
  let api: Record<string, jest.Mock>;

  const setup = async (id: string | null = null) => {
    api = {
      list: jest.fn().mockReturnValue(of([{ id: 'rep-1', period: '2026-09', status: 'SUCCEEDED', createdAt: '', finishedAt: '', error: null, language: 'es' }])),
      get: jest.fn().mockReturnValue(of(report())),
      request: jest.fn().mockReturnValue(of(report({ id: 'rep-2', period: '2026-08', status: 'QUEUED', content: null }))),
    };
    await TestBed.configureTestingModule({
      imports: [ManagerReportPage],
      providers: [
        { provide: ManagerReportService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(id ? { id } : {}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ManagerReportPage);
    fixture.detectChanges();
  };

  afterEach(() => fixture?.destroy());

  it('opens the latest written report and shows it with its recommendations', async () => {
    await setup();
    expect(api['get']).toHaveBeenCalledWith('rep-1');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Septiembre: más ventas, menos margen');
    expect(text).toContain('Cobrar a Tardío SRL');
    expect(fixture.componentInstance.unavailable()).toEqual(['payables']);
  });

  it('opens the report the notification links to', async () => {
    await setup('rep-9');
    expect(api['get']).toHaveBeenCalledWith('rep-9');
  });

  it('asks for the chosen month and shows that it is being written', async () => {
    await setup();
    fixture.componentInstance.period.set('2026-08');
    fixture.componentInstance.write();
    expect(api['request']).toHaveBeenCalledWith('2026-08');
    expect(fixture.componentInstance.writing()).toBe(true);
  });

  it('defaults to the month that just ended', () => {
    expect(previousPeriod(new Date(2026, 0, 15))).toBe('2025-12');
  });
});
