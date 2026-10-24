import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NotificationService } from '../../../core/services/notification';
import { McpConsentPage } from './mcp-consent.page';
import { McpService } from './mcp.service';

const QUERY = {
  response_type: 'code', client_id: 'c1', redirect_uri: 'https://claude.ai/cb', code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256', scope: 'erp:read erp:draft', state: 's', unrelated: 'dropped',
};

describe('McpConsentPage', () => {
  let fixture: ComponentFixture<McpConsentPage>;
  let api: Record<string, jest.Mock>;

  async function create(info = of({ clientName: 'Claude', redirectHost: 'claude.ai', scopes: ['erp:read', 'erp:draft'] })) {
    api = { consentInfo: jest.fn().mockReturnValue(info), consent: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [McpConsentPage],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(QUERY) } } },
        { provide: McpService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(McpConsentPage);
    fixture.detectChanges();
  }

  afterEach(() => fixture.destroy());

  it('asks the server about the request with only the OAuth parameters, and shows what the agent may do', async () => {
    await create();
    const sent = api['consentInfo'].mock.calls[0][0];
    expect(sent['client_id']).toBe('c1');
    expect(sent['unrelated']).toBeUndefined();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('ai.mcp.scope.read');
    expect(text).toContain('ai.mcp.scope.draft');
    expect(text).toContain('ai.mcp.consent_return');
  });

  it('says the request is invalid when the server refuses it, and offers no buttons', async () => {
    await create(throwError(() => ({ status: 400 })));
    expect(fixture.nativeElement.textContent).toContain('ai.mcp.invalid_request');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('sends the decision with the same parameters', async () => {
    await create();
    api['consent'].mockReturnValue(throwError(() => ({ status: 400 })));
    fixture.componentInstance.decide(false);
    expect(api['consent']).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'c1', state: 's' }), false);
    expect(fixture.componentInstance.busy()).toBe(false);
  });
});
