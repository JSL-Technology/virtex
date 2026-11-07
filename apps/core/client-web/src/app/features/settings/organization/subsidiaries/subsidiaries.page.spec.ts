import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CountryService } from '../../../../core/services/country.service';
import { NotificationService } from '../../../../core/services/notification';
import { ChartOfAccountsApiService } from '../../../accounting/data/chart-of-accounts.service';
import { SettingsShellService } from '../../shell';
import { SubsidiariesPage } from './subsidiaries.page';
import { Subsidiary, SubsidiariesService } from './subsidiaries.service';

/**
 * PERM-01: the company structure is read with `settings:view_company` and changed with
 * `settings:edit_company`. A reader sees the subsidiaries and the notice that says why they cannot
 * change them — never a button that opens a form the server would refuse.
 */
describe('SubsidiariesPage (read-only)', () => {
  const caribe: Subsidiary = {
    parentOrganizationId: 'parent',
    subsidiaryOrganizationId: 'sub',
    ownership: 80,
    acquisitionDate: '2025-01-01',
    acquisitionCost: 1000,
    investmentAccountId: null,
    controlEndedOn: null,
    subsidiary: { id: 'sub', legalName: 'Caribe Holding', taxId: '131-00000-1', country: 'DO' },
  };

  function create(options: { canEdit: boolean; list: Subsidiary[]; url?: string }) {
    TestBed.configureTestingModule({
      imports: [SubsidiariesPage],
      providers: [
        provideRouter([]),
        SettingsShellService,
        { provide: SubsidiariesService, useValue: { getSubsidiaries: () => of(options.list) } },
        {
          provide: CountryService,
          useValue: { getSupportedCountries: () => of([]), currentCountry: () => null, getCountryConfig: () => of(null) },
        },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showError: jest.fn(), httpErrorMessage: () => 'x' } },
        { provide: ChartOfAccountsApiService, useValue: { searchAccounts: () => of([]), getAccountById: () => of(null) } },
      ],
    });
    TestBed.inject(SettingsShellService).canEdit.set(options.canEdit);
    const router = TestBed.inject(Router);
    if (options.url) jest.spyOn(router, 'url', 'get').mockReturnValue(options.url);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(SubsidiariesPage);
    fixture.detectChanges();
    const buttons = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
    return { fixture, page: fixture.componentInstance, buttons, navigate };
  }

  afterEach(() => jest.restoreAllMocks());

  it('offers the first subsidiary to whoever may edit', () => {
    const { buttons } = create({ canEdit: true, list: [] });
    expect(buttons()).toContain('settings.subsidiaries.create_first_subsidiary');
  });

  it('shows a reader the empty state without the button, saying who can add one', () => {
    const { fixture, buttons } = create({ canEdit: false, list: [] });
    expect(buttons()).not.toContain('settings.subsidiaries.create_first_subsidiary');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('settings.subsidiaries.empty_readonly');
  });

  it('lists the subsidiaries for a reader without the edit button', () => {
    const { fixture, buttons } = create({ canEdit: false, list: [caribe] });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Caribe Holding');
    expect(buttons()).not.toContain('settings.subsidiaries.edit');
  });

  it('keeps the edit button for whoever may edit', () => {
    const { buttons } = create({ canEdit: true, list: [caribe] });
    expect(buttons()).toContain('settings.subsidiaries.edit');
  });

  it('ignores the open requests a reader cannot act on', () => {
    const { page } = create({ canEdit: false, list: [caribe] });
    page.openCreateModal();
    page.openEdit(caribe);
    expect(page.showModal()).toBe(false);
    expect(page.editing()).toBeNull();
  });

  it('opens the form from «Nueva subsidiaria» for whoever may edit, and settles the link on the list', () => {
    const { page, navigate } = create({ canEdit: true, list: [], url: '/e/acme/overview#settings/subsidiaries/new' });
    expect(page.showModal()).toBe(true);
    expect(navigate).toHaveBeenCalledWith([], { fragment: 'settings/subsidiaries', replaceUrl: true });
  });

  it('lands a reader following «Nueva subsidiaria» on the list, without the form', () => {
    const { page, navigate } = create({ canEdit: false, list: [], url: '/e/acme/overview#settings/subsidiaries/new' });
    expect(page.showModal()).toBe(false);
    expect(navigate).toHaveBeenCalledWith([], { fragment: 'settings/subsidiaries', replaceUrl: true });
  });
});
