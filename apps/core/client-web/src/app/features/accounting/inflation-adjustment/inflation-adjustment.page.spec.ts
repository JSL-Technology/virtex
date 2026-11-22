import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { InflationAdjustmentPage, shiftMonth } from './inflation-adjustment.page';
import { InflationAdjustmentService, RestatementOutlook, RestatementRunSummary } from '../data/inflation-adjustment.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { OrganizationSettingsService } from '../../settings/data/organization-settings.service';
import { AuthService } from '../../../core/services/auth';
import { previousMonth } from '../fixed-assets/depreciation-run.page';

/**
 * The inflation adjustment screen (FIN-AC-04): what a month's restatement would book, posting it —
 * or replacing it when the books moved since — undoing the latest one, and recording a month of
 * the index the platform has not loaded.
 */
describe('InflationAdjustmentPage', () => {
  const line = {
    accountId: 'equipment',
    accountCode: '1210',
    accountName: 'Equipos',
    postedAccountId: 'equipment',
    postedAccountCode: '1210',
    dimensions: null,
    historical: '600.00',
    restated: '726.00',
    bookBalance: '600.00',
    adjustment: '126.00',
    earliestOrigin: '2025-01',
  };
  const plan = (overrides: Partial<RestatementOutlook> = {}): RestatementOutlook => ({
    period: '2025-03',
    entryDate: '2025-03-31',
    ledgerId: 'ledger',
    ledgerName: 'Libro principal',
    currency: 'ARS',
    policy: 'YEAR_END',
    seriesCode: 'AR-FACPCE',
    seriesName: 'Serie FACPCE',
    closingIndex: { period: '2025-03', value: '133.1', revision: 1, source: 'COMPANY', valueId: 'v', publishedOn: null, reference: null, companyValue: null },
    missingIndexMonths: [],
    lines: [line],
    accounts: [line],
    netMonetaryResult: '134.00',
    netMonetaryAccountId: 'recpam',
    indexValues: {},
    blockers: [],
    dueAtClose: false,
    run: null,
    current: null,
    replacement: null,
    ...overrides,
  });
  const run: RestatementRunSummary = {
    id: 'run-1',
    period: '2025-03',
    status: 'POSTED',
    journalEntryId: 'je-1',
    reversalEntryId: null,
    netMonetaryResult: '134.00',
    lineCount: 5,
    ranAt: '2026-11-21T00:00:00.000Z',
    ranByUserId: null,
    reversedAt: null,
    reversalReason: null,
    seriesCode: 'AR-FACPCE',
    closingIndex: '133.1',
  };

  let api: Record<string, jest.Mock>;
  let dialog: Record<string, jest.Mock>;

  function create(outlook: RestatementOutlook, runs: RestatementRunSummary[] = []): InflationAdjustmentPage {
    api = {
      outlook: jest.fn().mockReturnValue(of(outlook)),
      runs: jest.fn().mockReturnValue(of(runs)),
      series: jest.fn().mockReturnValue(of([])),
      values: jest.fn().mockReturnValue(of([])),
      post: jest.fn().mockReturnValue(of({ created: true, run: { ...run, lines: [], indexValues: {} } })),
      reverse: jest.fn().mockReturnValue(of({ ...run, status: 'REVERSED', lines: [], indexValues: {} })),
      record: jest.fn().mockReturnValue(of({ recorded: 1, unchanged: 0 })),
    };
    dialog = { confirm: jest.fn().mockResolvedValue(true), prompt: jest.fn().mockResolvedValue('Índice revisado') };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: InflationAdjustmentService, useValue: api },
        { provide: NotificationService, useValue: { httpErrorMessage: jest.fn().mockReturnValue('x'), showHttpError: jest.fn(), showSuccess: jest.fn() } },
        { provide: DialogService, useValue: dialog },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
        { provide: OrganizationSettingsService, useValue: { update: jest.fn().mockReturnValue(of({})) } },
        { provide: AuthService, useValue: { hasPermissions: () => true } },
      ],
    });
    TestBed.overrideComponent(InflationAdjustmentPage, { set: { template: '' } });
    const page = TestBed.createComponent(InflationAdjustmentPage).componentInstance;
    page.ngOnInit();
    return page;
  }

  it('shows the month that just ended and posts its restatement after confirmation', async () => {
    const page = create(plan());
    expect(api['outlook']).toHaveBeenCalledWith(previousMonth());
    expect(api['values']).toHaveBeenCalledWith('AR-FACPCE', shiftMonth(previousMonth(), -12), previousMonth());
    expect(page.accounts()).toEqual([line]);
    expect(page.canPost()).toBe(true);

    await page.post();
    expect(dialog['confirm']).toHaveBeenCalledWith(expect.objectContaining({ messageParams: { period: '2025-03', count: 1, result: '134.00' } }));
    expect(api['post']).toHaveBeenCalledWith('2025-03', false);
  });

  it('offers no posting while something blocks the month, nor for a run that still holds', () => {
    expect(create(plan({ blockers: [{ key: 'inflation_adjustment.closing_index_missing' }] })).canPost()).toBe(false);
    TestBed.resetTestingModule();
    expect(create(plan({ run, current: true, lines: [] })).canPost()).toBe(false);
  });

  it('replaces a run the books outgrew, and shows the full restatement a replacement books', async () => {
    const replacement = plan({ netMonetaryResult: '187.60' });
    const page = create(plan({ run, current: false, replacement }), [run]);
    expect(page.shown()?.netMonetaryResult).toBe('187.60');
    await page.post();
    expect(api['post']).toHaveBeenCalledWith('2025-03', true);
  });

  it('undoes only the latest month restated, with a reason', async () => {
    const older = { ...run, id: 'run-0', period: '2025-02' };
    const page = create(plan({ run, current: true, lines: [] }), [run, older]);
    expect(page.latestPosted()?.id).toBe('run-1');
    await page.reverse(run);
    expect(api['reverse']).toHaveBeenCalledWith('run-1', 'Índice revisado');
  });

  it('records a month of the index for the company, decimal comma or point', () => {
    const page = create(plan());
    page.entryPeriod.set('2025-03');
    page.entryValue.set('140,5');
    page.recordIndex();
    expect(api['record']).toHaveBeenCalledWith('AR-FACPCE', [{ period: '2025-03', value: '140.5' }]);
  });

  it('moves months across years', () => {
    expect(shiftMonth('2025-03', -12)).toBe('2024-03');
    expect(shiftMonth('2025-01', -1)).toBe('2024-12');
  });
});
