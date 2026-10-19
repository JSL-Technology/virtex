import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';
import { CopilotApiService, CopilotChart } from './copilot-api.service';
import { PinnedChartsComponent } from './pinned-charts.component';

const drawn: CopilotChart = {
  id: 'g-1',
  title: 'Ventas por mes',
  type: 'line',
  sourceTool: 'sales_trend',
  pinned: true,
  createdAt: '2026-10-19T00:00:00Z',
  data: { categories: ['2026-09'], series: [{ name: 'Ventas', values: [250] }], unit: 'DOP', omitted: 0, drawnAt: '2026-10-19T00:00:00Z' },
};

describe('PinnedChartsComponent', () => {
  const setup = (api: Record<string, jest.Mock>, permitted = true) => {
    TestBed.configureTestingModule({
      imports: [PinnedChartsComponent],
      providers: [
        { provide: CopilotApiService, useValue: api },
        { provide: AuthService, useValue: { hasPermissions: () => permitted } },
        { provide: NotificationService, useValue: { showHttpError: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(PinnedChartsComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('draws each pinned chart, and says so when one can no longer be drawn for this person', () => {
    const lost: CopilotChart = { ...drawn, id: 'g-2', title: 'Nómina', data: null, unavailable: 'not_allowed' };
    const fixture = setup({ pinnedCharts: jest.fn().mockReturnValue(of([drawn, lost])), unpin: jest.fn() });
    const cards = fixture.nativeElement.querySelectorAll('app-copilot-chart');
    expect(cards).toHaveLength(2);
    expect(cards[1].textContent).toContain('ai.copilot.chart.unavailable.not_allowed');
  });

  it('takes a chart off when it is unpinned', () => {
    const api = { pinnedCharts: jest.fn().mockReturnValue(of([drawn])), unpin: jest.fn().mockReturnValue(of(undefined)) };
    const fixture = setup(api);
    (fixture.nativeElement.querySelector('.cc__pin') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api.unpin).toHaveBeenCalledWith('g-1');
    expect(fixture.nativeElement.querySelector('app-copilot-chart')).toBeNull();
  });

  it('shows nothing, and asks nothing, without the assistant', () => {
    const api = { pinnedCharts: jest.fn().mockReturnValue(throwError(() => ({ status: 403 }))), unpin: jest.fn() };
    expect(setup(api, false).nativeElement.textContent.trim()).toBe('');
    expect(api.pinnedCharts).not.toHaveBeenCalled();
  });
});
