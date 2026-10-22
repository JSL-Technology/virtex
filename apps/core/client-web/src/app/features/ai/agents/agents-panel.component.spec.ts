import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AiAgentsPanelComponent } from './agents-panel.component';
import { AgentsApiService } from './agents.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';

describe('AiAgentsPanelComponent', () => {
  let fixture: ComponentFixture<AiAgentsPanelComponent>;
  let api: Record<string, jest.Mock>;

  beforeEach(async () => {
    api = {
      replenishmentSettings: jest.fn().mockReturnValue(of({ enabled: false, warehouseIds: [], submitForApproval: false, maxOrderAmount: null })),
      updateReplenishment: jest.fn((changes) => of({ enabled: false, warehouseIds: [], submitForApproval: false, maxOrderAmount: null, ...changes })),
      runReplenishment: jest.fn().mockReturnValue(of({ runId: 'r', orders: [{ kind: 'purchase_order', id: 'po', label: 'OC-1', link: '/purchasing/orders/po/edit', state: 'DRAFT' }] })),
      runs: jest.fn().mockReturnValue(
        of([
          {
            id: 'r', agent: 'replenishment', trigger: 'SCHEDULED', status: 'SUCCEEDED', summary: { orders: 1 },
            proposals: [{ kind: 'purchase_order', id: 'po', label: 'OC-1', link: '/purchasing/orders/po/edit', state: 'DRAFT' }],
            notes: [{ key: 'no_supplier', params: { count: 1, products: 'Aceite' } }], startedAt: '2026-10-18T07:13:00Z', finishedAt: '2026-10-18T07:13:05Z',
          },
        ]),
      ),
      copilotProposals: jest.fn().mockReturnValue(of([])),
      copilotFeedback: jest.fn().mockReturnValue(of({ last30Days: { up: 0, down: 0, reported: 0 }, items: [] })),
    };
    await TestBed.configureTestingModule({
      imports: [AiAgentsPanelComponent],
      providers: [
        provideRouter([]),
        { provide: AgentsApiService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showSuccess: jest.fn() } },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['procurement:manage']), hasPermissions: () => true } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AiAgentsPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows each run with what it proposed and why it skipped', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('OC-1');
    expect(text).toContain('ai.agents.note.no_supplier');
  });

  it('turns the agent on, and sets or clears the limit', () => {
    fixture.componentInstance.update({ enabled: true });
    expect(api['updateReplenishment']).toHaveBeenCalledWith({ enabled: true });
    fixture.componentInstance.setLimit('25000');
    expect(api['updateReplenishment']).toHaveBeenLastCalledWith({ maxOrderAmount: 25000 });
    fixture.componentInstance.setLimit('');
    expect(api['updateReplenishment']).toHaveBeenLastCalledWith({ maxOrderAmount: null });
  });

  it('runs on request and reloads the log', () => {
    fixture.componentInstance.runNow();
    expect(api['runReplenishment']).toHaveBeenCalled();
    expect(api['runs']).toHaveBeenCalledTimes(2);
  });
});
