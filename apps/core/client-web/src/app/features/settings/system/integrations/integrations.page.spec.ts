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

  function create() {
    TestBed.configureTestingModule({
      imports: [IntegrationSettingsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Without the panels' permissions they draw nothing and ask for nothing.
        { provide: AuthService, useValue: { hasPermissions: () => false } },
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

  it('does not repeat pages that have their own place in the sidebar', () => {
    const fixture = create();
    const fragments = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(fragments.some((href) => /settings\/(sso|fiscal|extensions)/.test(href))).toBe(false);
  });
});
