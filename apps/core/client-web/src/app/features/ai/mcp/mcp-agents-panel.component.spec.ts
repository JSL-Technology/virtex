import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { McpAgentsPanelComponent } from './mcp-agents-panel.component';
import { McpService } from './mcp.service';

describe('McpAgentsPanelComponent', () => {
  let fixture: ComponentFixture<McpAgentsPanelComponent>;
  let api: Record<string, jest.Mock | string>;
  let notifications: { showHttpError: jest.Mock };
  let dialog: { confirm: jest.Mock };

  async function create(allowed = true) {
    api = {
      endpoint: 'https://api.test/api/v1/mcp',
      grants: jest.fn().mockReturnValue(of([{ id: 'g1', client: 'Claude', scope: 'erp:read erp:draft', since: '2026-10-01T00:00:00Z', lastUsedAt: null }])),
      revoke: jest.fn().mockReturnValue(of(undefined)),
    };
    notifications = { showHttpError: jest.fn() };
    dialog = { confirm: jest.fn().mockResolvedValue(true) };
    await TestBed.configureTestingModule({
      imports: [McpAgentsPanelComponent],
      providers: [
        { provide: McpService, useValue: api },
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: dialog },
        { provide: AuthService, useValue: { hasPermissions: () => allowed } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(McpAgentsPanelComponent);
    fixture.detectChanges();
  }

  afterEach(() => fixture.destroy());

  it('lists the connected agents and the address to connect one', async () => {
    await create();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Claude');
    expect(text).toContain('https://api.test/api/v1/mcp');
    expect(text).toContain('ai.mcp.scope.draft');
  });

  it('asks before disconnecting an agent, and keeps it listed when declined or when that fails', async () => {
    await create();
    const grant = fixture.componentInstance.grants()[0];
    dialog.confirm.mockResolvedValueOnce(false);
    await fixture.componentInstance.revoke(grant);
    expect(api['revoke']).not.toHaveBeenCalled();

    (api['revoke'] as jest.Mock).mockReturnValueOnce(throwError(() => ({ status: 500 })));
    await fixture.componentInstance.revoke(grant);
    expect(fixture.componentInstance.grants()).toHaveLength(1);
    expect(notifications.showHttpError).toHaveBeenCalled();
    await fixture.componentInstance.revoke(grant);
    expect(api['revoke']).toHaveBeenLastCalledWith('g1');
    expect(fixture.componentInstance.grants()).toHaveLength(0);
  });

  it('says the list could not be read, and reads it again on retry', async () => {
    await create();
    (api['grants'] as jest.Mock).mockReturnValueOnce(throwError(() => ({ status: 500 })));
    fixture.componentInstance.load();
    expect(fixture.componentInstance.state()).toBe('error');
    fixture.componentInstance.load();
    expect(fixture.componentInstance.state()).toBe('ready');
    expect(fixture.componentInstance.grants()).toHaveLength(1);
  });

  it('shows nothing, and asks for nothing, to someone without the copilot', async () => {
    await create(false);
    expect(api['grants']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('section')).toBeNull();
  });
});
