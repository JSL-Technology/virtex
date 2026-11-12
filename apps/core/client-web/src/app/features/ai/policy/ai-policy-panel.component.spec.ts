import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AiPolicyPanelComponent } from './ai-policy-panel.component';
import { AiPolicy, AiPolicyService } from './ai-policy.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';

const policy = (overrides: Partial<AiPolicy['settings']> = {}): AiPolicy => ({
  settings: {
    languageModels: true,
    disabledFeatures: [],
    scheduledReports: false,
    imageEmbeddings: false,
    monthlyBudgetUsd: 200,
    dailyBudgetUsd: null,
    conversationRetentionDays: 180,
    maskIdentifiers: true,
    activityMonitoring: false,
    maxMonthlyBudgetUsd: 10_000,
    ...overrides,
  },
  spend: { monthUsd: 170, dayUsd: 3 },
  features: ['bill_capture', 'copilot'],
});

describe('AiPolicyPanelComponent', () => {
  let fixture: ComponentFixture<AiPolicyPanelComponent>;
  let api: { get: jest.Mock; update: jest.Mock };
  let dialog: { confirm: jest.Mock };

  const create = async (permissions: string[]) => {
    api = { get: jest.fn().mockReturnValue(of(policy())), update: jest.fn((change) => of(policy(change))) };
    dialog = { confirm: jest.fn().mockResolvedValue(true) };
    await TestBed.configureTestingModule({
      imports: [AiPolicyPanelComponent],
      providers: [
        { provide: AiPolicyService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showSuccess: jest.fn() } },
        { provide: DialogService, useValue: dialog },
        { provide: AuthService, useValue: { hasPermissions: (required: string[]) => required.every((p) => permissions.includes(p)) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AiPolicyPanelComponent);
    fixture.detectChanges();
  };

  afterEach(() => fixture.destroy());

  it('shows the month spent against the budget', async () => {
    await create(['ai_settings:manage']);
    expect(fixture.componentInstance.spentShare()).toBe(85);
    expect(fixture.nativeElement.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('85');
  });

  it('holds the edits until they are saved, and sends only what changed', async () => {
    await create(['ai_settings:manage']);
    const panel = fixture.componentInstance;
    panel.toggleFeature('bill_capture', false);
    panel.setBudget('monthlyBudgetUsd', '');
    expect(api.update).not.toHaveBeenCalled();
    expect(panel.dirty()).toBe(true);
    expect(await panel.save()).toBe(true);
    expect(api.update).toHaveBeenCalledWith({ disabledFeatures: ['bill_capture'], monthlyBudgetUsd: null });
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('says why it cannot be saved instead of dropping a value out of range', async () => {
    await create(['ai_settings:manage']);
    const panel = fixture.componentInstance;
    panel.setRetention('0');
    expect(panel.dirty()).toBe(true);
    expect(panel.blocked()?.key).toBe('ai.policy.retention_invalid');
    expect(await panel.save()).toBe(false);
    panel.setBudget('monthlyBudgetUsd', '20000');
    panel.setRetention('30');
    expect(panel.blocked()?.key).toBe('ai.policy.budget_over_max');
    expect(String(panel.blocked()?.params['max'])).toMatch(/10[.,\s]?000/);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('asks before starting to send data, and keeps the edit unsaved when declined', async () => {
    await create(['ai_settings:manage']);
    const panel = fixture.componentInstance;
    panel.patch({ scheduledReports: true });
    dialog.confirm.mockResolvedValueOnce(false);
    expect(await panel.save()).toBe(false);
    expect(api.update).not.toHaveBeenCalled();
    expect(panel.dirty()).toBe(true);
    expect(await panel.save()).toBe(true);
    expect(dialog.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'ai.policy.confirm_send' }));
    expect(api.update).toHaveBeenCalledWith({ scheduledReports: true });
  });

  it('puts the policy in effect back when the edits are discarded', async () => {
    await create(['ai_settings:manage']);
    const panel = fixture.componentInstance;
    panel.patch({ maskIdentifiers: false });
    panel.discard();
    expect(panel.dirty()).toBe(false);
    expect(panel.draft()?.maskIdentifiers).toBe(true);
  });

  it('is read-only without the settings permission: the boxes are disabled and nothing is sent', async () => {
    await create(['ai_usage:view']);
    const boxes = [...fixture.nativeElement.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    fixture.componentInstance.patch({ languageModels: false });
    expect(await fixture.componentInstance.save()).toBe(false);
    expect(api.update).not.toHaveBeenCalled();
  });
});
