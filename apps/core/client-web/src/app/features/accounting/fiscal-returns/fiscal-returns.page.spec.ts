import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { of } from 'rxjs';
import { FiscalReturnsPage } from './fiscal-returns.page';
import { FiscalReturnFiling, FiscalReturnsService, ReturnFiling } from '../data/fiscal-returns.service';
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
    available: jest.Mock;
    filings: jest.Mock;
    activeSince: jest.Mock;
    download: jest.Mock;
    check: jest.Mock;
    markSubmitted: jest.Mock;
    clearSubmission: jest.Mock;
  };

  /** What a market declares it files, as the server answers it. */
  const declared = (overrides: Partial<ReturnFiling> = {}): ReturnFiling => ({
    code: '606',
    labelKey: 'returns.do.606',
    periodicity: 'MONTHLY',
    mediaType: 'text/plain; charset=utf-8',
    extension: 'txt',
    tracked: true,
    permission: null,
    options: [],
    ...overrides,
  });

  const DGII: readonly ReturnFiling[] = ['606', '607', '608', '609'].map((code) =>
    declared({ code, labelKey: `returns.do.${code}` }),
  );

  const SAT: readonly ReturnFiling[] = [
    declared({ code: 'catalogo', labelKey: 'returns.mx.catalogo', mediaType: 'application/xml', extension: 'xml' }),
    declared({
      code: 'balanza',
      labelKey: 'returns.mx.balanza',
      mediaType: 'application/xml',
      extension: 'xml',
      options: [
        { name: 'tipoEnvio', labelKey: 'returns.mx.option.tipo_envio', kind: 'CHOICE', values: ['N', 'C'], required: false },
        { name: 'fechaModBal', labelKey: 'returns.mx.option.fecha_mod_bal', kind: 'DATE', required: false },
      ],
    }),
    declared({
      code: 'polizas',
      labelKey: 'returns.mx.polizas',
      periodicity: 'ON_REQUEST',
      tracked: false,
      mediaType: 'application/xml',
      extension: 'xml',
      options: [
        {
          name: 'tipoSolicitud',
          labelKey: 'returns.mx.option.tipo_solicitud',
          kind: 'CHOICE',
          values: ['AF', 'FC', 'DE', 'CO'],
          required: false,
        },
        { name: 'numOrden', labelKey: 'returns.mx.option.num_orden', kind: 'TEXT', required: false },
        { name: 'numTramite', labelKey: 'returns.mx.option.num_tramite', kind: 'TEXT', required: false },
      ],
    }),
  ];

  const FILES: Record<string, readonly ReturnFiling[]> = { DO: DGII, MX: SAT, CO: [], US: [] };
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
      available: jest.fn().mockReturnValue(of(FILES[country])),
      filings: jest.fn().mockReturnValue(of(rows)),
      activeSince: jest.fn().mockReturnValue(of({ activeSince })),
      download: jest.fn().mockReturnValue(of({ blob: new Blob(['x']), fileName: 'DGII_606_202503.txt' })),
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

  it('shows what the market declares it files, in its own order, and loads the year', () => {
    const { page } = create('DO');
    expect(page.kinds().map((filing) => filing.code)).toEqual(['606', '607', '608', '609']);
    expect(service.filings).toHaveBeenCalledWith(new Date().getFullYear());
  });

  it('puts the monthly documents in the calendar and the on-request one in its own panel', () => {
    const { page } = create('MX');
    expect(page.kinds().map((filing) => filing.code)).toEqual(['catalogo', 'balanza']);
    expect(page.onRequest().map((filing) => filing.code)).toEqual(['polizas']);
  });

  it('says so, rather than showing an empty calendar, in a market that files nothing from here', () => {
    const { page } = create('CO');
    expect(page.filesNothing()).toBe(true);
    expect(page.empty()).toBe(true);
    expect(service.filings).not.toHaveBeenCalled();
  });

  it('offers the reports to prepare with, naming the country, where no generator exists (C-06)', () => {
    const { page, fixture } = create('US');
    expect(page.filesNothing()).toBe(true);
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

  it('sends each filing the options its own market declared, and only those', () => {
    const { page } = create('MX');
    page.setYear(2025);
    page.select('balanza', 2);

    // Nothing typed: the file is asked for as the authority publishes it.
    page.download('balanza', 2);
    expect(service.download).toHaveBeenLastCalledWith('balanza', 2025, 2, {});

    const [tipoEnvio, fechaModBal] = page.optionsFor('balanza');
    page.setOption('balanza', tipoEnvio, 'C');
    page.setOption('balanza', fechaModBal, '2025-04-02');
    page.download('balanza', 2);
    expect(service.download).toHaveBeenLastCalledWith('balanza', 2025, 2, { tipoEnvio: 'C', fechaModBal: '2025-04-02' });

    // Another cell, another filing: what was typed for the last one is not carried over.
    page.select('catalogo', 2);
    expect(page.optionsOf('balanza')).toEqual({});
  });

  it('asks for an on-request filing by its own month and options', () => {
    const { page } = create('MX');
    page.setYear(2025);
    page.setRequestMonth('polizas', 5);
    const [request, order] = page.optionsFor('polizas');
    page.setOption('polizas', request, 'FC');
    page.setOption('polizas', order, 'ABC1234567/25');

    page.downloadOnRequest('polizas');

    expect(service.download).toHaveBeenLastCalledWith('polizas', 2025, 5, {
      tipoSolicitud: 'FC',
      numOrden: 'ABC1234567/25',
    });
  });

  it('saves the file under the name its authority gave it', () => {
    const { page } = create('DO', [filing()]);
    page.setYear(2025);
    service.download.mockReturnValue(of({ blob: new Blob(['x']), fileName: 'DGII_606_202503.txt' }));
    page.download('606', 3);
    // The name travels with the file: how a return is called is its authority's convention.
    expect(service.download).toHaveBeenCalledWith('606', 2025, 3, {});
  });

  it('names a filing by the label its own market declares', () => {
    const { page } = create('MX');
    expect(page.labelOf('balanza')).toBe('returns.mx.balanza');
  });
});
