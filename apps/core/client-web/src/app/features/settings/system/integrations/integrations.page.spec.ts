import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../core/services/auth';
import { SsoAdminService } from '../../../../core/services/sso-admin.service';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { ExtensionsService } from '../../../extensions/extensions.service';
import { IntegrationSettingsPage } from './integrations.page';

/** QA M-09: the integrations the product has, with their live state, instead of «En desarrollo». */
describe('IntegrationSettingsPage', () => {
  let http: HttpTestingController;

  function create(permissions: string[], ssoFails = false) {
    TestBed.configureTestingModule({
      imports: [IntegrationSettingsPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { hasPermissions: ([p]: string[]) => permissions.includes(p) } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/acme${path}` } },
        {
          provide: ExtensionsService,
          useValue: { consents: () => of([{ enabled: true }, { enabled: false }, { enabled: true }]) },
        },
        {
          provide: SsoAdminService,
          useValue: { listProviders: () => (ssoFails ? throwError(() => new Error('500')) : of([])) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(IntegrationSettingsPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => http.verify());

  const card = (page: IntegrationSettingsPage, id: string) => page.cards().find((c) => c.id === id)!;

  it('reads each integration’s live state', () => {
    const page = create(['extensions:view', 'settings:edit_company', 'taxes:view']);
    http.expectOne((r) => r.url.endsWith('/einvoicing/regime/settings')).flush(null);

    expect(card(page, 'extensions')).toMatchObject({ state: 'active', params: { enabled: 2 }, link: '/acme/extensions' });
    expect(card(page, 'sso').state).toBe('inactive');
    expect(card(page, 'einvoicing').state).toBe('inactive');
    expect(page.statusKey(card(page, 'extensions'))).toBe('settings.integrations.extensions.active');
  });

  it('says it cannot tell, rather than guessing, without the permission or when the read fails', () => {
    const page = create(['settings:edit_company'], true);
    http.expectNone((r) => r.url.includes('/einvoicing'));
    expect(card(page, 'extensions').state).toBe('unknown');
    expect(card(page, 'einvoicing').state).toBe('unknown');
    expect(card(page, 'sso').state).toBe('unknown');
  });
});
