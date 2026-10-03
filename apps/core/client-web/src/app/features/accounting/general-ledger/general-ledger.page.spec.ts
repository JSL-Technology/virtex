import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { StatementExportService } from '../../../core/export/statement-export.service';
import { GeneralLedgerPage } from './general-ledger.page';

/**
 * The general ledger chooses its own account (QA A-13): opened from the menu it said "no account
 * was specified" and offered no way to specify one; and «Exportar» did nothing.
 */
describe('GeneralLedgerPage', () => {
  let http: HttpTestingController;
  const exporter = { exportGeneralLedger: jest.fn() };

  function create(accountId: string | null) {
    TestBed.configureTestingModule({
      imports: [GeneralLedgerPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(accountId ? { accountId } : {}) } } },
        { provide: StatementExportService, useValue: exporter },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(GeneralLedgerPage);
    fixture.detectChanges();
    return fixture;
  }

  const ledger = {
    initialBalance: 100,
    finalBalance: 150,
    account: { id: 'acc-1', code: '1101', name: 'Caja' },
    lines: [{ id: 'l1', date: '2026-09-02', reference: 'AS-1', description: 'Cobro', debit: 50, credit: null, balance: 150 }],
  };

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  it('opened from the menu, asks for an account instead of failing', () => {
    const fixture = create(null);
    http.expectNone((r) => r.url.includes('/general-ledger'));
    expect(fixture.componentInstance.error()).toBeNull();
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('loads the ledger of the account chosen in the selector, and exports it', () => {
    const fixture = create(null);
    const page = fixture.componentInstance;

    page.selectAccount('acc-1');
    const req = http.expectOne((r) => r.url.endsWith('/general-ledger'));
    expect(req.request.params.get('accountId')).toBe('acc-1');
    req.flush(ledger);

    expect(page.ledgerLines()).toHaveLength(1);
    page.export();
    expect(exporter.exportGeneralLedger).toHaveBeenCalledWith(ledger, page.startDate, page.endDate);
  });

  it('still opens straight on an account linked from the chart of accounts', async () => {
    const fixture = create('acc-1');
    http.expectOne((r) => r.url.endsWith('/general-ledger') && r.params.get('accountId') === 'acc-1').flush(ledger);
    fixture.detectChanges();
    await fixture.whenStable();
    // The selector names the account it was opened on.
    http.expectOne((r) => r.url.endsWith('/chart-of-accounts/acc-1')).flush({ id: 'acc-1', code: '1101', name: 'Caja' });
  });
});
