import { Repository } from 'typeorm';
import { FiscalReportFiling, FiscalReportFilingStatus } from './entities/fiscal-report-filing.entity';
import { FilingPeriod, FiscalReportFilingsService } from './fiscal-report-filings.service';

/**
 * The filing calendar: generated, filed, and whether what was filed is still what the books say.
 */
describe('FiscalReportFilingsService', () => {
  const period: FilingPeriod = { organizationId: 'org-1', kind: '606', year: 2026, month: 8 };

  /** A table keyed by organization, kind and period, with the upsert the service relies on. */
  function inMemoryRepository(): { repository: Repository<FiscalReportFiling>; rows: FiscalReportFiling[] } {
    const rows: FiscalReportFiling[] = [];
    const matches = (row: FiscalReportFiling, where: Partial<FiscalReportFiling>) =>
      Object.entries(where).every(([key, value]) => row[key as keyof FiscalReportFiling] === value);
    const repository = {
      upsert: jest.fn(async (values: Partial<FiscalReportFiling>) => {
        const existing = rows.find((row) =>
          matches(row, {
            organizationId: values.organizationId,
            kind: values.kind,
            year: values.year,
            month: values.month,
          }),
        );
        if (existing) Object.assign(existing, values);
        else rows.push({ status: FiscalReportFilingStatus.GENERATED, submittedHash: null, ...values } as FiscalReportFiling);
      }),
      findOne: jest.fn(async ({ where }: { where: Partial<FiscalReportFiling> }) =>
        rows.find((row) => matches(row, where)) ?? null,
      ),
      find: jest.fn(async ({ where }: { where: Partial<FiscalReportFiling> }) =>
        rows.filter((row) => matches(row, where)),
      ),
      save: jest.fn(async (row: FiscalReportFiling) => row),
    } as unknown as Repository<FiscalReportFiling>;
    return { repository, rows };
  }

  /**
   * How many records a file carries is the generator's own answer — it built them — and not a
   * function of the file's shape: counting lines after a header worked for a pipe-delimited format
   * and needed a special case per XML document, which is how this module came to know the names of
   * the SAT's elements.
   */
  it('records the count the generator declared, and a hash of the file, on each generation', async () => {
    const { repository } = inMemoryRepository();
    const service = new FiscalReportFilingsService(repository);

    const view = await service.recordGeneration(period, '606|131190317|202608|2\na\nb', 2, 'user-1');

    expect(view.status).toBe(FiscalReportFilingStatus.GENERATED);
    expect(view.recordCount).toBe(2);
    expect(view.lastHash).toMatch(/^[0-9a-f]{64}$/);
    expect(view.changedSinceSubmission).toBe(false);
  });

  it('declares a filing with its acknowledgement, and flags a later generation that differs', async () => {
    const { repository } = inMemoryRepository();
    const service = new FiscalReportFilingsService(repository);
    await service.recordGeneration(period, '606|131190317|202608|1\na', 1, 'user-1');

    const filed = await service.markSubmitted(period, '  ACUSE-123  ', 'user-1');
    expect(filed.status).toBe(FiscalReportFilingStatus.SUBMITTED);
    expect(filed.submissionReference).toBe('ACUSE-123');
    expect(filed.submittedRecordCount).toBe(1);
    expect(filed.changedSinceSubmission).toBe(false);

    // The same data again: still what was filed.
    expect((await service.recordGeneration(period, '606|131190317|202608|1\na', 1, 'user-1')).changedSinceSubmission).toBe(false);

    // A bill posted into the filed month after filing: a rectifying return is due.
    const changed = await service.recordGeneration(period, '606|131190317|202608|2\na\nb', 2, 'user-2');
    expect(changed.status).toBe(FiscalReportFilingStatus.SUBMITTED);
    expect(changed.changedSinceSubmission).toBe(true);
    expect(changed.submittedRecordCount).toBe(1);
    expect(changed.recordCount).toBe(2);
  });

  it('undoes a filing declared by mistake', async () => {
    const { repository } = inMemoryRepository();
    const service = new FiscalReportFilingsService(repository);
    await service.recordGeneration(period, '606|131190317|202608|0', 0, 'user-1');
    await service.markSubmitted(period, 'ACUSE-1', 'user-1');

    const cleared = await service.clearSubmission(period);
    expect(cleared.status).toBe(FiscalReportFilingStatus.GENERATED);
    expect(cleared.submissionReference).toBeNull();
    expect(cleared.submittedAt).toBeNull();
  });

  it('refuses to declare a period that was never generated', async () => {
    const service = new FiscalReportFilingsService(inMemoryRepository().repository);
    await expect(service.markSubmitted(period, 'ACUSE-1', 'user-1')).rejects.toMatchObject({
      messageKey: 'compliance.fiscal_report_not_generated',
      params: { kind: '606', period: '2026-08' },
    });
  });
});
