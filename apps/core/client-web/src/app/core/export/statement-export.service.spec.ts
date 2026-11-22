import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { LocaleStore } from '@virtex/shared/ui-i18n';
import type { LocaleContextContract } from '@virtex/shared/types';
import type { TrialBalanceReport } from '../../features/reports/data/financial-reporting.service';
import type { GeneralLedger } from '../models/general-ledger.model';
// The catalogues the application ships.
import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';

const downloads: Array<{ filename: string; csv: string }> = [];
jest.mock('./csv-export', () => {
  const actual = jest.requireActual('./csv-export');
  return { ...actual, downloadCsv: (filename: string, csv: string) => downloads.push({ filename, csv }) };
});

// Imported after the mock, so it writes into `downloads` instead of the browser.
import { StatementExportService } from './statement-export.service';

/**
 * A statement exported in the reader's language, the books', or both (books bilingual). The
 * controller of a Dominican company sends the parent company its statements in English; the DGII,
 * the bank and the local auditor read them in Spanish; the group auditor reads both.
 */
describe('StatementExportService — the language of an export', () => {
  const dominican: LocaleContextContract = {
    language: 'en',
    locale: 'en-US',
    direction: 'ltr',
    countryCode: 'DO',
    currency: 'DOP',
    timezone: 'America/Santo_Domingo',
    booksLanguage: 'es',
    firstDayOfWeek: 0,
  };
  const trialBalance: TrialBalanceReport = {
    period: { startDate: '2026-01-01', endDate: '2026-01-31' },
    ledger: { id: 'l', name: 'Libro principal', nameTranslations: { en: 'Main ledger' }, currency: 'DOP' },
    rows: [
      {
        accountId: 'a',
        code: '1120',
        name: { es: 'Bancos', en: 'Bank Accounts', pt: 'Bancos' },
        type: 'ASSET',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 500,
        periodCredit: 0,
        closingDebit: 500,
        closingCredit: 0,
      },
    ],
    totals: { openingDebit: 0, openingCredit: 0, periodDebit: 500, periodCredit: 0, closingDebit: 500, closingCredit: 0 },
    isBalanced: true,
  };
  let exporter: StatementExportService;

  beforeEach(() => {
    downloads.length = 0;
    localStorage.clear();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', en as Record<string, string>);
    translate.setTranslation('es', es as Record<string, string>);
    translate.use('en');
    const store = TestBed.inject(LocaleStore);
    store.setLanguage('en');
    store.setTenantContext(dominican);
    exporter = TestBed.inject(StatementExportService);
  });

  const lastCsv = () => downloads[downloads.length - 1]?.csv ?? '';

  it('in the reader\'s language: headings, the ledger and the accounts in English', async () => {
    await exporter.exportTrialBalance(trialBalance, 'reader');
    const csv = lastCsv();
    expect(csv).toContain('Bank Accounts');
    expect(csv).toContain('Main ledger');
    expect(csv).not.toContain('Bancos');
  });

  it('in the books language: what the DGII and a local auditor read, though the reader reads English', async () => {
    await exporter.exportTrialBalance(trialBalance, 'books');
    const csv = lastCsv();
    expect(csv).toContain('Bancos');
    expect(csv).toContain('Libro principal');
    expect(csv).toContain(es['reports.trial_balance.trial_balance' as keyof typeof es] as string);
    expect(csv).not.toContain('Bank Accounts');
  });

  it('bilingual: the books\' words first, the reader\'s beside them', async () => {
    await exporter.exportTrialBalance(trialBalance, 'bilingual');
    const csv = lastCsv();
    expect(csv).toContain('Bancos / Bank Accounts');
    expect(csv).toContain('Libro principal / Main ledger');
    const title = `${es['reports.trial_balance.trial_balance' as keyof typeof es]} / ${en['reports.trial_balance.trial_balance' as keyof typeof en]}`;
    expect(csv).toContain(title);
  });

  it('writes the narratives the system wrote as the chosen reading reads them — the record in the books', async () => {
    const ledger: GeneralLedger = {
      initialBalance: 0,
      finalBalance: -500,
      account: { id: 'a', code: '1120', name: 'Bancos' },
      lines: [
        {
          id: 'x',
          date: '2026-01-15',
          reference: 'GENERAL-2026-000002',
          description: 'Reversión: QA depósito',
          descriptionKey: 'ledger.reversal.line',
          descriptionParams: { line: 'QA depósito' },
          debit: null,
          credit: 500,
          balance: -500,
        },
      ],
    };
    await exporter.exportGeneralLedger(ledger, '2026-01-01', '2026-01-31', 'reader');
    expect(lastCsv()).toContain('Reversal: QA depósito');
    await exporter.exportGeneralLedger(ledger, '2026-01-01', '2026-01-31', 'books');
    expect(lastCsv()).toContain('Reversión: QA depósito');
    expect(lastCsv()).not.toContain('Reversal:');
    await exporter.exportGeneralLedger(ledger, '2026-01-01', '2026-01-31', 'bilingual');
    expect(lastCsv()).toContain('Reversión: QA depósito / Reversal: QA depósito');
  });

  it('names an account category in words, never by its code', async () => {
    await exporter.exportBalanceSheet(
      {
        asOfDate: '2026-01-31',
        ledger: trialBalance.ledger,
        assets: { sections: [{ category: 'CURRENT_ASSET', accounts: [{ accountId: 'a', code: '1120', name: { es: 'Bancos', en: 'Bank Accounts' }, category: 'CURRENT_ASSET', amount: 500 }], subtotal: 500 }], total: 500 },
        liabilities: { sections: [], total: 0 },
        equity: { sections: [], total: 500, unclosedResult: 500 },
        totalLiabilitiesAndEquity: 500,
        isBalanced: true,
        outOfBalanceBy: 0,
      } as never,
      'reader',
    );
    expect(lastCsv()).toContain(en['accounting.categories.current_asset' as keyof typeof en] as string);
    expect(lastCsv()).not.toContain('CURRENT_ASSET');
  });
});
