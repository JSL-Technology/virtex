import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { CompanySwitcherComponent } from './company-switcher.component';
import { AuthService } from '../../../../core/services/auth';
import { OrganizationService } from '../../../../shared/service/organization.service';
import { TabStateService } from '../../../../core/tabs/tab-state.service';
import { TabPersistenceService } from '../../../../core/tabs/tab-persistence.service';

/**
 * Switching tenant is a server operation, and this component used to pretend otherwise.
 *
 * `selectOrganization` ended at `// In a real app, this would call a service to switch
 * organization.`: it cleared every open tab and the persisted workspace, then left the user in the
 * tenant they started in. The interface reported a change that never happened, and destroyed the
 * user's workspace on the way.
 */
describe('CompanySwitcherComponent', () => {
  const ORG_A = { id: 'org-a', legalName: 'Cliente A' };
  const ORG_B = { id: 'org-b', legalName: 'Cliente B' };

  let fixture: ComponentFixture<CompanySwitcherComponent>;
  let component: CompanySwitcherComponent;
  let reload: jest.SpyInstance;

  const organizationService = {
    switchOrganization: jest.fn().mockReturnValue(of({ user: {} })),
  };
  const tabState = { reset: jest.fn() };
  const tabPersistence = { clearState: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    organizationService.switchOrganization.mockReturnValue(of({ user: {} }));

    await TestBed.configureTestingModule({
      imports: [CompanySwitcherComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: () => ({ organization: ORG_A, organizations: [ORG_A, ORG_B] }),
          },
        },
        { provide: OrganizationService, useValue: organizationService },
        { provide: TabStateService, useValue: tabState },
        { provide: TabPersistenceService, useValue: tabPersistence },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompanySwitcherComponent);
    component = fixture.componentInstance;
    // `window.location` cannot be redefined in jsdom, so the reload is observed through the
    // component's own seam.
    reload = jest
      .spyOn(component as unknown as { reloadApplication: () => void }, 'reloadApplication')
      .mockImplementation(() => undefined);
    fixture.detectChanges();
  });

  it('lists the tenants the user actually belongs to', () => {
    // Three hardcoded placeholders once lived here — 'Virtex Corp', 'Acme Industries',
    // 'Globex Corporation' — none of which the user could switch into.
    expect(component.filteredOrganizations().map((o) => o.id)).toEqual(['org-a', 'org-b']);
  });

  it('calls the server to switch, rather than only clearing local state', () => {
    component.selectOrganization(ORG_B as never);

    expect(organizationService.switchOrganization).toHaveBeenCalledWith('org-b');
  });

  it('clears the workspace only after the server confirms', () => {
    let confirm!: () => void;
    organizationService.switchOrganization.mockReturnValue(
      new (require('rxjs').Observable)((subscriber: { next: (v: unknown) => void }) => {
        confirm = () => subscriber.next({ user: {} });
      }),
    );

    component.selectOrganization(ORG_B as never);
    expect(tabPersistence.clearState).not.toHaveBeenCalled();

    confirm();
    expect(tabPersistence.clearState).toHaveBeenCalled();
    expect(tabState.reset).toHaveBeenCalled();
  });

  it('reloads so every resolver re-runs against the new tenant', () => {
    component.selectOrganization(ORG_B as never);
    expect(reload).toHaveBeenCalled();
  });

  it('keeps the workspace intact when the switch fails', () => {
    organizationService.switchOrganization.mockReturnValue(throwError(() => new Error('403')));

    component.selectOrganization(ORG_B as never);

    expect(tabPersistence.clearState).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(component.switchError()).toBe('No se pudo cambiar de empresa.');
    expect(component.switching()).toBe(false);
  });

  it('does nothing when the active tenant is selected again', () => {
    component.selectOrganization(ORG_A as never);

    expect(organizationService.switchOrganization).not.toHaveBeenCalled();
  });

  it('will not close the dropdown mid-switch, which would hide the error', () => {
    organizationService.switchOrganization.mockReturnValue(
      new (require('rxjs').Observable)(() => undefined),
    );
    component.isOpen.set(true);

    component.selectOrganization(ORG_B as never);
    component.closeDropdown();

    expect(component.isOpen()).toBe(true);
  });
});
