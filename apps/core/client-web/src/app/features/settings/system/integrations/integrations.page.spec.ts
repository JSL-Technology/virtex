import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../core/services/auth';
import { SsoAdminService } from '../../../../core/services/sso-admin.service';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { ExtensionsService } from '../../../extensions/extensions.service';
import { IntegrationSettingsPage } from './integrations.page';

/** QA M-09: the integrations the product has, with their live state, instead of «En desarrollo». */
describe('IntegrationSettingsPage', () => {
  let http: HttpTestingController;
  const listProviders = jest.fn();

  function create(permissions: string[], ssoFails = false, features: string[] = ['enterprise_sso']) {
    TestBed.configureTestingModule({
      imports: [IntegrationSettingsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { hasPermissions: ([p]: string[]) => permissions.includes(p), hasFeature: (f: string) => features.includes(f) } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/acme${path}` } },
        {
          provide: ExtensionsService,
          useValue: { consents: () => of([{ enabled: true }, { enabled: false }, { enabled: true }]) },
        },
        {
          provide: SsoAdminService,
          useValue: { listProviders: listProviders.mockImplementation(() => (ssoFails ? throwError(() => new Error('500')) : of([]))) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(IntegrationSettingsPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => http.verify());

  const card = (page: IntegrationSettingsPage, id: string) => {
    const found = page.cards().find((c) => c.id === id);
    if (!found) throw new Error(`no ${id} card`);
    return found;
  };

  it('reads each integration’s live state', () => {
    const page = create(['extensions:view', 'settings:edit_company', 'taxes:view']);
    http.expectOne((r) => r.url.endsWith('/einvoicing/regime/settings')).flush(null);

    expect(card(page, 'extensions')).toMatchObject({ state: 'active', params: { enabled: 2 }, link: '/acme/extensions' });
    expect(card(page, 'sso').state).toBe('inactive');
    expect(card(page, 'einvoicing').state).toBe('inactive');
    expect(page.statusKey(card(page, 'extensions'))).toBe('settings.integrations.extensions.active');
  });

  it('single sign-on off the Enterprise plan: no card, and nothing asked of an API that refuses', () => {
    listProviders.mockClear();
    const page = create(['extensions:view', 'settings:edit_company', 'taxes:view'], false, []);
    http.expectOne((r) => r.url.endsWith('/einvoicing/regime/settings')).flush(null);
    expect(page.cards().map((c) => c.id)).toEqual(['extensions', 'einvoicing', 'data']);
    expect(listProviders).not.toHaveBeenCalled();
  });

  it('says it cannot tell, rather than guessing, without the permission or when the read fails', () => {
    const page = create(['settings:edit_company'], true);
    http.expectNone((r) => r.url.includes('/einvoicing'));
    expect(card(page, 'extensions').state).toBe('unknown');
    expect(card(page, 'einvoicing').state).toBe('unknown');
    expect(card(page, 'sso').state).toBe('unknown');
  });
});
