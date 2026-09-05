// `class-transformer`'s `@Type()` reads design-time metadata, which only exists once the
// polyfill is loaded. Nest loads it at bootstrap; a spec that imports the DTOs directly has to.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GenerateReportDto } from './dto/generate-report.dto';
import {
  GeneralLedgerReportDto,
  MAX_LEDGER_REPORT_ACCOUNTS,
} from '../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';
import { AgingReportDto } from './dto/aging-report.dto';

/**
 * The report request contract.
 *
 * These run the validators directly rather than through a live HTTP stack, because the question is
 * what the DTOs declare — and the answer used to be "very little". The discriminator resolved two
 * of the three report types to their DTOs and everything else to `Object`, which
 * `class-validator` reads as "no rules", so `@ValidateNested()` passed anything it was handed.
 *
 * The pipe is configured to match `main.ts`: `whitelist` and `forbidNonWhitelisted` are what turn
 * an undeclared property from ignored into rejected, and a DTO validated as `Object` has no
 * declared properties at all — so the strictest setting in the application had no effect on this
 * endpoint.
 */
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true };

function errorsFor(body: unknown): string[] {
  const dto = plainToInstance(GenerateReportDto, body, {
    enableImplicitConversion: false,
  });
  return validateSync(dto as object, OPTIONS).flatMap(function flatten(error): string[] {
    const own = Object.values(error.constraints ?? {});
    const nested = (error.children ?? []).flatMap(flatten);
    return [...own, ...nested];
  });
}

describe('report parameters', () => {
  const validLedgerOptions = {
    ledgerId: '11111111-1111-4111-8111-111111111111',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    accountIds: ['22222222-2222-4222-8222-222222222222'],
  };

  it('accepts a well-formed general ledger request', () => {
    expect(
      errorsFor({ reportType: 'general-ledger', options: validLedgerOptions }),
    ).toEqual([]);
  });

  /**
   * `reportType` was `@IsString()` typed as a union, and TypeScript erases the union at run time.
   * Any string passed validation and reached the handler's `switch`, whose `default` branch was the
   * only thing that ever caught it.
   */
  it('refuses a report type it does not know', () => {
    const errors = errorsFor({ reportType: 'payroll', options: {} });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('refuses a missing report type', () => {
    expect(errorsFor({ options: validLedgerOptions }).length).toBeGreaterThan(0);
  });

  /**
   * The hole the discriminator left.
   *
   * With `reportType: 'aging-report'` the `@Type()` factory returned `Object`, so nothing about
   * `options` was checked and nothing was stripped from it.
   */
  it('validates the options of an ageing report instead of accepting any object', () => {
    const errors = errorsFor({
      reportType: 'aging-report',
      options: { ledgerId: 'not-a-uuid', somethingElse: 'anything at all' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts an ageing report with no options beyond the ledger', () => {
    expect(
      errorsFor({
        reportType: 'aging-report',
        options: { ledgerId: '11111111-1111-4111-8111-111111111111' },
      }),
    ).toEqual([]);
  });

  it('refuses an undeclared property inside the options', () => {
    const errors = errorsFor({
      reportType: 'general-ledger',
      options: { ...validLedgerOptions, sortBy: 'account' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('refuses an output format it cannot produce', () => {
    const errors = errorsFor({
      reportType: 'general-ledger',
      options: validLedgerOptions,
      outputFormat: 'xlsx',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  // ── The general ledger's own parameters ────────────────────────────────────

  /**
   * `accountIds` was `@IsOptional()`, and the service rejected an empty list afterwards. The
   * contract said optional and the behaviour said required, which is the kind of disagreement a
   * client only discovers in production.
   */
  it('requires at least one account', () => {
    const errors = errorsFor({
      reportType: 'general-ledger',
      options: { ...validLedgerOptions, accountIds: [] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('refuses more accounts than one report may carry', () => {
    const tooMany = Array.from(
      { length: MAX_LEDGER_REPORT_ACCOUNTS + 1 },
      (_, index) => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
    );
    const errors = errorsFor({
      reportType: 'general-ledger',
      options: { ...validLedgerOptions, accountIds: tooMany },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('refuses an account id that is not a uuid', () => {
    const errors = errorsFor({
      reportType: 'general-ledger',
      options: { ...validLedgerOptions, accountIds: ['1 OR 1=1'] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('refuses a date that is not a date', () => {
    const errors = errorsFor({
      reportType: 'general-ledger',
      options: { ...validLedgerOptions, startDate: 'yesterday' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  /**
   * `@IsBoolean()` on its own rejects the string a query parameter arrives as, so the flag was
   * usable only from a JSON body — which is why the daybook DTO already carried a `@Transform` and
   * the ledger DTO did not.
   */
  it('accepts the unposted flag as the string a query parameter arrives as', () => {
    const dto = plainToInstance(GeneralLedgerReportDto, {
      ...validLedgerOptions,
      includeUnposted: 'true',
    });
    expect(validateSync(dto, OPTIONS)).toEqual([]);
    expect(dto.includeUnposted).toBe(true);
  });

  // ── The daybook's own parameters ───────────────────────────────────────────

  it('accepts a well-formed daybook request', () => {
    expect(
      errorsFor({
        reportType: 'journal',
        options: { startDate: '2026-01-01', endDate: '2026-01-31' },
      }),
    ).toEqual([]);
  });

  it('refuses a daybook page size beyond the ceiling', () => {
    const dto = plainToInstance(JournalReportDto, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      pageSize: 100_000,
    });
    expect(validateSync(dto, OPTIONS).length).toBeGreaterThan(0);
  });

  it('refuses a journal id that is not a uuid', () => {
    const errors = errorsFor({
      reportType: 'journal',
      options: {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        journalIds: ['; DROP TABLE journal_entries; --'],
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('refuses an ageing report ledger that is not a uuid', () => {
    const dto = plainToInstance(AgingReportDto, { ledgerId: 'primary' });
    expect(validateSync(dto, OPTIONS).length).toBeGreaterThan(0);
  });
});
