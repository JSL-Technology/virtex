import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SsoAdminService } from '../../../../core/services/sso-admin.service';
import { NotificationService } from '../../../../core/services/notification';
import { RolesService } from '../../data/roles.service';
import { SettingsShellService } from '../../shell';
import { SsoSettingsPage } from './sso.page';

/**
 * PERM-01: domains and providers are read with `settings:view_company` and changed with
 * `settings:edit_company`. Empty, the page used to tell a reader to «write it above» — above there
 * was nothing to write in — and that they «must verify a domain» before an action they cannot take.
 */
describe('SsoSettingsPage (read-only)', () => {
  function create(canEdit: boolean) {
    TestBed.configureTestingModule({
      imports: [SsoSettingsPage],
      providers: [
        SettingsShellService,
        { provide: SsoAdminService, useValue: { listDomains: () => of([]), listProviders: () => of([]) } },
        { provide: RolesService, useValue: { getRoles: () => of([]) } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showError: jest.fn(), httpErrorMessage: () => 'x' } },
      ],
    });
    TestBed.inject(SettingsShellService).canEdit.set(canEdit);
    const fixture = TestBed.createComponent(SsoSettingsPage);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('tells whoever may edit what to do next', () => {
    const text = create(true);
    expect(text).toContain('settings.sso.no_domains_description');
    expect(text).toContain('settings.sso.no_providers_description');
    expect(text).toContain('settings.sso.you_must_verify_least_one_domain');
    expect(text).toContain('settings.sso.add_provider');
  });

  it('tells a reader who can change it, and gives no instructions for actions they cannot take', () => {
    const text = create(false);
    expect(text).toContain('settings.sso.no_domains_readonly');
    expect(text).toContain('settings.sso.no_providers_readonly');
    expect(text).not.toContain('settings.sso.no_domains_description');
    expect(text).not.toContain('settings.sso.you_must_verify_least_one_domain');
    expect(text).not.toContain('settings.sso.add_provider');
  });
});
