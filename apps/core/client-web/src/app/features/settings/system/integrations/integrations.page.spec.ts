import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../../../core/services/auth';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { IntegrationSettingsPage } from './integrations.page';

/**
 * What the company configures here and nowhere else. Extensions, SSO and electronic invoicing have
 * their own pages in the sidebar; this page used to repeat them as cards (ARQ-01).
 */
describe('IntegrationSettingsPage', () => {
  let http: HttpTestingController;

  function create(canUsePanels = false) {
    TestBed.configureTestingModule({
      imports: [IntegrationSettingsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Without the panels' permissions they draw nothing and ask for nothing.
        { provide: AuthService, useValue: { hasPermissions: () => canUsePanels } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/acme${path}` } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(IntegrationSettingsPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('links to bulk import and export in the application', () => {
    const fixture = create();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a.link-button');
    expect(link?.getAttribute('href')).toBe('/acme/data-imports');
  });

  /** Fail every pending request as a dropped connection would. */
  function dropAll(filter: (url: string) => boolean = () => true): void {
    for (const req of http.match((r) => filter(r.url))) req.error(new ProgressEvent('error'), { status: 0, statusText: '' });
  }

  it('says once that nothing could be read when both panels fail, and retries both', () => {
    const fixture = create(true);
    dropAll();
    fixture.detectChanges();
    const page = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    expect(page.allFailed()).toBe(true);
    // One error for the page; the panels, with their own, are hidden while it speaks for them.
    expect(root.querySelectorAll('.int-page > vx-error-state').length).toBe(1);
    expect((root.querySelector('.int-page__panels') as HTMLElement).style.display).toBe('none');

    page.retryAll();
    const retried = http.match(() => true);
    expect(retried.some((r) => r.request.url.includes('/mcp/oauth/grants'))).toBe(true);
    expect(retried.some((r) => !r.request.url.includes('/mcp/'))).toBe(true);
    retried.forEach((r) => r.flush([]));
  });

  it('keeps the error in its panel when only one of them fails', () => {
    const fixture = create(true);
    dropAll((url) => !url.includes('/mcp/'));
    http.match((r) => r.url.includes('/mcp/')).forEach((r) => r.flush([]));
    fixture.detectChanges();

    expect(fixture.componentInstance.allFailed()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.int-page > vx-error-state').length).toBe(0);
  });

  it('does not repeat pages that have their own place in the sidebar', () => {
    const fixture = create();
    const fragments = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(fragments.some((href) => /settings\/(sso|fiscal|extensions)/.test(href))).toBe(false);
  });
});
