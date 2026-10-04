import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/services/auth';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { FiscalYearsService, YearEndReadiness } from '../../data/fiscal-years.service';
import { AnnualClosePage } from './annual-close.page';

/** QA M-09: «Cierre anual: no disponible» while the close existed on the server. */
describe('AnnualClosePage', () => {
  const years = [
    { id: 'fy27', startDate: '2027-01-01', endDate: '2027-12-31', status: 'OPEN' as const },
    { id: 'fy26', startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' as const },
  ];
  const blocked: YearEndReadiness = {
    fiscalYear: years[1],
    checks: [
      { id: 'periods_closed', ok: false, blocking: true, params: { count: 2, open: 'Nov, Dic' } },
      { id: 'retained_earnings', ok: false, blocking: true, params: {} },
      { id: 'earlier_years_closed', ok: true, blocking: false, params: { count: 0 } },
    ],
    result: { result: 13000, accounts: 2 },
    canClose: false,
  };
  const api = {
    list: jest.fn(() => of(years)),
    readiness: jest.fn(() => of(blocked)),
    close: jest.fn(() => of({ messageKey: 'accounting.fiscal_year_ending_has_closed', messageParams: {}, fiscalYear: years[1] })),
    reopen: jest.fn(),
  };
  const dialog = { confirm: jest.fn(), prompt: jest.fn() };
  const notifications = { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: jest.fn(() => 'x') };

  function create() {
    TestBed.configureTestingModule({
      imports: [AnnualClosePage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: FiscalYearsService, useValue: api },
        { provide: DialogService, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
        { provide: AuthService, useValue: { hasPermissions: () => true } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (p: string) => `/acme${p}` } },
      ],
    });
    const fixture = TestBed.createComponent(AnnualClosePage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => jest.clearAllMocks());

  it('opens on the oldest open year and says what stands in the way, with where to fix it', () => {
    const page = create();
    expect(api.readiness).toHaveBeenCalledWith('fy26');
    const [periods, retained] = page.checks();
    expect(periods).toMatchObject({ text: 'accounting.annual_close.check.periods_closed_failing', link: '/acme/accounting/periods' });
    expect(retained).toMatchObject({ fragment: 'settings/accounting', link: null });
  });

  it('does not close a year that is not ready', async () => {
    const page = create();
    await page.close();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.close).not.toHaveBeenCalled();
  });

  it('closes a ready year only after confirmation', async () => {
    api.readiness.mockReturnValue(of({ ...blocked, checks: [], canClose: true }));
    const page = create();
    dialog.confirm.mockResolvedValueOnce(false);
    await page.close();
    expect(api.close).not.toHaveBeenCalled();

    dialog.confirm.mockResolvedValueOnce(true);
    await page.close();
    expect(api.close).toHaveBeenCalledWith('fy26');
    expect(notifications.showSuccess).toHaveBeenCalledWith('accounting.fiscal_year_ending_has_closed', {});
  });
});
