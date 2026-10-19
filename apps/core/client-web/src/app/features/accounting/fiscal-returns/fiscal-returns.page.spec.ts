import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { of } from 'rxjs';
import { FiscalReturnsPage } from './fiscal-returns.page';
import { FiscalReturnFiling, FiscalReturnsService, returnFileName } from '../data/fiscal-returns.service';
import { signal } from '@angular/core';
import { CountryPackService } from '../../../core/api/country-pack.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/services/auth';

describe('FiscalReturnsPage', () => {
  const filing = (overrides: Partial<FiscalReturnFiling> = {}): FiscalReturnFiling => ({
    kind: '606',
    year: 2025,
    month: 3,
    status: 'GENERATED',
    recordCount: 12,
    lastHash: 'a'.repeat(64),
    lastGeneratedAt: '2025-04-10T12:00:00.000Z',
    submittedRecordCount: null,
    submittedAt: null,
    submissionReference: null,
    changedSinceSubmission: false,
    ...overrides,
  });

  let service: {
    filings: jest.Mock;
    activeSince: jest.Mock;
    download: jest.Mock;
    check: jest.Mock;
    markSubmitted: jest.Mock;
    clearSubmission: jest.Mock;
  };
  let dialog: { prompt: jest.Mock; confirm: jest.Mock };

  /** The slice of the country pack this page reads (QA C-06): its return generator and due day. */
  const PACKS: Record<string, { generator: 'DGII' | 'SAT' | null; dueDay: number | null }> = {
    DO: { generator: 'DGII', dueDay: 15 },
    MX: { generator: 'SAT', dueDay: null },
    CO: { generator: null, dueDay: null },
    US: { generator: null, dueDay: null },
  };

  function create(
    country: string,
    rows: FiscalReturnFiling[] = [],
    permissions = true,
    activeSince = '2020-01-01',
  ) {
    service = {
      filings: jest.fn().mockReturnValue(of(rows)),
      activeSince: jest.fn().mockReturnValue(of({ activeSince })),
      download: jest.fn().mockReturnValue(of(new Blob(['x']))),
      check: jest.fn(),
      markSubmitted: jest.fn(),
      clearSubmission: jest.fn(),
    };
    dialog = { prompt: jest.fn(), confirm: jest.fn() };
    TestBed.configureTestingModule({
      imports: [FiscalReturnsPage],
      providers: [
        { provide: FiscalReturnsService, useValue: service },
        {
          provide: CountryPackService,
          useValue: {
            pack: signal({
              countryCode: country,
              fiscalReturns: {
                ...PACKS[country],
                prepareWith: [{ labelKey: 'localization.country_pack.reports.trial_balance', route: '/reports/financial-statements/trial-balance' }],
              },
            }),
          },
        },
        {
          provide: NotificationService,
          useValue: { httpErrorMessage: () => 'x', showHttpError: jest.fn(), showError: jest.fn(), showInfo: jest.fn(), showSuccess: jest.fn() },
        },
        { provide: DialogService, useValue: dialog },
        { provide: AuthService, useValue: { hasPermissions: () => permissions } },
      ],
    });
    const fixture = TestBed.createComponent(FiscalReturnsPage);
    fixture.detectChanges();
    return { page: fixture.componentInstance, fixture };
  }

  it('shows the DGII formats for a Dominican company and loads the year', () => {
    const { page } = create('DO');
    expect(page.market()).toBe('DO');
    expect(page.kinds()).toEqual(['606', '607', '608', '609']);
    expect(service.filings).toHaveBeenCalledWith(new Date().getFullYear());
  });

  it('shows the SAT monthly documents for a Mexican company', () => {
    const { page } = create('MX');
    expect(page.kinds()).toEqual(['catalogo', 'balanza']);
  });

  it('says so, rather than showing an empty calendar, in a market without returns', () => {
    const { page } = create('CO');
    expect(page.market()).toBe('OTHER');
    expect(page.empty()).toBe(true);
    expect(service.filings).not.toHaveBeenCalled();
  });

  it('offers the reports to prepare with, naming the country, where no generator exists (C-06)', () => {
    const { page, fixture } = create('US');
    expect(page.market()).toBe('OTHER');
    expect(page.prepareWith().map((report) => report.route)).toEqual(['/reports/financial-statements/trial-balance']);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('fiscal_returns.not_available_title');
    expect(text).not.toContain('DGII');
  });

  it('marks months before the company existed «not applicable», never overdue (A-15)', () => {
    const { page } = create('DO', [], true, '2025-09-14');
    page.setYear(2025);
    expect(page.state('606', 1)).toBe('not_applicable');
    expect(page.state('606', 8)).toBe('not_applicable');
    expect(page.state('606', 9)).toBe('overdue');
    // The year selector never offers a year before the company's first activity.
    expect(Math.min(...page.years())).toBe(2025);
  });

  it('colours each month by where its return stands', () => {
    const { page } = create('DO', [
      filing({ kind: '606', month: 1, status: 'SUBMITTED', submissionReference: 'A-1' }),
      filing({ kind: '607', month: 1, status: 'SUBMITTED', changedSinceSubmission: true }),
      filing({ kind: '608', month: 1 }),
    ]);
    page.setYear(2025);
    service.filings.mockReturnValue(of([
      filing({ kind: '606', month: 1, status: 'SUBMITTED', submissionReference: 'A-1' }),
      filing({ kind: '607', month: 1, status: 'SUBMITTED', changedSinceSubmission: true }),
      filing({ kind: '608', month: 1 }),
    ]));
    page.load();

    expect(page.state('606', 1)).toBe('submitted');
    expect(page.state('607', 1)).toBe('changed');
    // Generated but never filed, and long past the 15th of February 2025.
    expect(page.state('608', 1)).toBe('overdue');
    expect(page.state('609', 1)).toBe('overdue');
    expect(page.changedCount()).toBe(1);
    expect(page.months()).toHaveLength(12);
  });

  it('flags nothing overdue in Mexico, whose deadlines depend on the taxpayer', () => {
    const { page } = create('MX');
    page.setYear(2025);
    expect(page.state('balanza', 1)).toBe('missing');
  });

  it('dates the DGII deadline on the 15th of the following month', () => {
    const { page } = create('DO');
    page.setYear(2025);
    expect(page.dueDate(12)).toBe('2026-01-15');
  });

  it('declares a month filed with the acknowledgement the user enters', async () => {
    const { page } = create('DO', [filing()]);
    page.setYear(2025);
    dialog.prompt.mockResolvedValue('  ACUSE-9  ');
    service.markSubmitted.mockReturnValue(of(filing({ status: 'SUBMITTED', submissionReference: 'ACUSE-9' })));

    await page.markSubmitted('606', 3);

    expect(service.markSubmitted).toHaveBeenCalledWith('606', 2025, 3, 'ACUSE-9');
    expect(page.filingOf('606', 3)?.status).toBe('SUBMITTED');
  });

  it('does nothing when the user cancels the prompt', async () => {
    const { page } = create('DO', [filing()]);
    dialog.prompt.mockResolvedValue(null);
    await page.markSubmitted('606', 3);
    expect(service.markSubmitted).not.toHaveBeenCalled();
  });

  it('downloads the complementary balanza with its modification date, and refuses one without', () => {
    const { page } = create('MX');
    page.setYear(2025);
    page.select('balanza', 2);
    page.complementary.set(true);

    page.download('balanza', 2);
    expect(service.download).not.toHaveBeenCalled();

    page.modifiedOn.set('2025-04-02');
    page.download('balanza', 2);
    expect(service.download).toHaveBeenCalledWith('balanza', 2025, 2, { tipoEnvio: 'C', fechaModBal: '2025-04-02' });
  });

  it('sends the order number for an audit and the procedure number for an offset', () => {
    const { page } = create('MX');
    page.setYear(2025);
    page.polizasMonth.set(5);
    page.polizasReference.set('ABC1234567/25');

    page.polizasRequest.set('FC');
    page.downloadPolizas();
    expect(service.download).toHaveBeenLastCalledWith('polizas', 2025, 5, { tipoSolicitud: 'FC', numOrden: 'ABC1234567/25' });

    page.polizasRequest.set('CO');
    page.downloadPolizas();
    expect(service.download).toHaveBeenLastCalledWith('polizas', 2025, 5, { tipoSolicitud: 'CO', numTramite: 'ABC1234567/25' });
  });

  it('names the files the way each authority expects them', () => {
    expect(returnFileName('606', 2026, 8)).toBe('DGII_606_202608.txt');
    expect(returnFileName('balanza', 2026, 8)).toBe('SAT_balanza_202608.xml');
  });
});
