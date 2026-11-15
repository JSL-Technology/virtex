import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../../core/services/auth';
import { DialogService } from '../../core/services/dialog.service';
import { NotificationService } from '../../core/services/notification';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';
import { UnauthorizedPage } from './unauthorized.page';

/** Two refusals, two remedies: a role is asked for, a plan is changed (IA-02). */
describe('UnauthorizedPage', () => {
  const render = (query: Record<string, string>, billingViewer: boolean) => {
    const params = convertToParamMap(query);
    TestBed.configureTestingModule({
      imports: [UnauthorizedPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(params), snapshot: { queryParamMap: params } } },
        { provide: AuthService, useValue: { hasPermissions: () => billingViewer, hasFeature: () => false } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/e/qa${path}` } },
        { provide: DialogService, useValue: { prompt: jest.fn() } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showHttpError: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(UnauthorizedPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  afterEach(() => TestBed.resetTestingModule());

  it('a feature the plan lacks: says so, and leads whoever sees the subscription to the plans', () => {
    const page = render({ url: '/e/qa/reports/anomalies', feature: 'ai_anomalies' }, true);
    expect(page.textContent).toContain('saas.plan_required.title');
    expect(page.textContent).not.toContain('unauthorized.request_permission');
    const plans = page.querySelector('a[href*="settings/billing"]') as HTMLAnchorElement;
    expect(plans.getAttribute('href')).toBe('/e/qa/overview#settings/billing');
  });

  it('…and tells anyone else who to ask', () => {
    const page = render({ url: '/e/qa/reports/anomalies', feature: 'ai_anomalies' }, false);
    expect(page.textContent).toContain('saas.plan_required.ask_admin');
    expect(page.querySelector('a[href*="settings/billing"]')).toBeNull();
  });

  it('a missing permission is the access request it always was; an unknown feature is ignored', () => {
    const page = render({ url: '/e/qa/payroll', feature: 'no_such_feature' }, true);
    expect(page.textContent).toContain('unauthorized.access_denied');
    expect(page.textContent).toContain('unauthorized.request_permission');
  });
});
