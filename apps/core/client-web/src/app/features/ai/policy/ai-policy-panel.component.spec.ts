import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AiPolicyPanelComponent } from './ai-policy-panel.component';
import { AiPolicy, AiPolicyService } from './ai-policy.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';

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
    maxMonthlyBudgetUsd: 10_000,
    ...overrides,
  },
  spend: { monthUsd: 170, dayUsd: 3 },
  features: ['bill_capture', 'copilot'],
});

describe('AiPolicyPanelComponent', () => {
  let fixture: ComponentFixture<AiPolicyPanelComponent>;
  let api: { get: jest.Mock; update: jest.Mock };

  const create = async (permissions: string[]) => {
    api = { get: jest.fn().mockReturnValue(of(policy())), update: jest.fn((change) => of(policy(change))) };
    await TestBed.configureTestingModule({
      imports: [AiPolicyPanelComponent],
      providers: [
        { provide: AiPolicyService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showSuccess: jest.fn() } },
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

  it('switches one feature off, and clears a budget back to the default', async () => {
    await create(['ai_settings:manage']);
    fixture.componentInstance.toggleFeature('bill_capture', false);
    expect(api.update).toHaveBeenCalledWith({ disabledFeatures: ['bill_capture'] });
    fixture.componentInstance.setBudget('monthlyBudgetUsd', '');
    expect(api.update).toHaveBeenLastCalledWith({ monthlyBudgetUsd: null });
    fixture.componentInstance.setRetention('0');
    expect(api.update).toHaveBeenCalledTimes(2);
  });

  it('is read-only without the settings permission: the boxes are disabled and nothing is sent', async () => {
    await create(['ai_usage:view']);
    const boxes = [...fixture.nativeElement.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    fixture.componentInstance.save({ languageModels: false });
    expect(api.update).not.toHaveBeenCalled();
  });
});
