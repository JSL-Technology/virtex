import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AiAgentsPanelComponent } from './agents-panel.component';
import { AgentsApiService } from './agents.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';

/** The agents' settings, saved like every form of the settings window. Their log is «Actividad de la IA». */
describe('AiAgentsPanelComponent', () => {
  let fixture: ComponentFixture<AiAgentsPanelComponent>;
  let api: Record<string, jest.Mock>;
  const settings = { enabled: false, warehouseIds: [], submitForApproval: false, maxOrderAmount: null };

  async function create(permissions = ['ai_settings:manage']) {
    api = {
      replenishmentSettings: jest.fn().mockReturnValue(of(settings)),
      updateReplenishment: jest.fn((changes) => of({ ...settings, ...changes })),
    };
    await TestBed.configureTestingModule({
      imports: [AiAgentsPanelComponent],
      providers: [
        { provide: AgentsApiService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showSuccess: jest.fn() } },
        { provide: AuthService, useValue: { hasPermissions: (required: string[]) => required.every((p) => permissions.includes(p)) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AiAgentsPanelComponent);
    fixture.detectChanges();
  }

  afterEach(() => fixture.destroy());

  it('holds the agent’s settings until they are saved, and sets or clears the limit', async () => {
    await create();
    const panel = fixture.componentInstance;
    panel.patch({ enabled: true });
    panel.setLimit('25000');
    expect(api['updateReplenishment']).not.toHaveBeenCalled();
    expect(panel.dirty()).toBe(true);
    expect(await panel.save()).toBe(true);
    expect(api['updateReplenishment']).toHaveBeenCalledWith({ enabled: true, submitForApproval: false, maxOrderAmount: 25000 });
    panel.setLimit('');
    expect(panel.draft()?.maxOrderAmount).toBeNull();
  });

  it('drops the edits on discard', async () => {
    await create();
    const panel = fixture.componentInstance;
    panel.patch({ submitForApproval: true });
    panel.discard();
    expect(panel.dirty()).toBe(false);
  });

  it('says the settings could not be read, and reads them again on retry', async () => {
    await create();
    api['replenishmentSettings'].mockReturnValueOnce(throwError(() => ({ status: 500 })));
    fixture.componentInstance.load();
    expect(fixture.componentInstance.state()).toBe('error');
    fixture.componentInstance.load();
    expect(fixture.componentInstance.state()).toBe('ready');
  });

  it('is read-only without the settings permission', async () => {
    await create(['ai_usage:view']);
    const boxes = [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
    expect(boxes.every((box) => box.disabled)).toBe(true);
    fixture.componentInstance.patch({ enabled: true });
    expect(await fixture.componentInstance.save()).toBe(false);
  });
});
