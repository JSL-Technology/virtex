import { Repository } from 'typeorm';
import { FiscalReportFiling, FiscalReportFilingStatus } from './entities/fiscal-report-filing.entity';
import { countRecords, FilingPeriod, FiscalReportFilingsService } from './fiscal-report-filings.service';

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

  it('records the record count and a hash of the file on each generation', async () => {
    const { repository } = inMemoryRepository();
    const service = new FiscalReportFilingsService(repository);

    const view = await service.recordGeneration(period, '606|131190317|202608|2\na\nb', 'user-1');

    expect(view.status).toBe(FiscalReportFilingStatus.GENERATED);
    expect(view.recordCount).toBe(2);
    expect(view.lastHash).toMatch(/^[0-9a-f]{64}$/);
    expect(view.changedSinceSubmission).toBe(false);
  });

  it('declares a filing with its acknowledgement, and flags a later generation that differs', async () => {
    const { repository } = inMemoryRepository();
    const service = new FiscalReportFilingsService(repository);
    await service.recordGeneration(period, '606|131190317|202608|1\na', 'user-1');

    const filed = await service.markSubmitted(period, '  ACUSE-123  ', 'user-1');
    expect(filed.status).toBe(FiscalReportFilingStatus.SUBMITTED);
    expect(filed.submissionReference).toBe('ACUSE-123');
    expect(filed.submittedRecordCount).toBe(1);
    expect(filed.changedSinceSubmission).toBe(false);

    // The same data again: still what was filed.
    expect((await service.recordGeneration(period, '606|131190317|202608|1\na', 'user-1')).changedSinceSubmission).toBe(false);

    // A bill posted into the filed month after filing: a rectifying return is due.
    const changed = await service.recordGeneration(period, '606|131190317|202608|2\na\nb', 'user-2');
    expect(changed.status).toBe(FiscalReportFilingStatus.SUBMITTED);
    expect(changed.changedSinceSubmission).toBe(true);
    expect(changed.submittedRecordCount).toBe(1);
    expect(changed.recordCount).toBe(2);
  });

  it('undoes a filing declared by mistake', async () => {
    const { repository } = inMemoryRepository();
    const service = new FiscalReportFilingsService(repository);
    await service.recordGeneration(period, '606|131190317|202608|0', 'user-1');
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

  it('counts records per format: lines after the header, accounts in the SAT XML', () => {
    expect(countRecords('607', '607|1|202608|0|0.00')).toBe(0);
    expect(countRecords('608', '608|1|202608|2\nx|1|01\ny|2|02\n')).toBe(2);
    expect(countRecords('balanza', '<BCE:Balanza><BCE:Ctas NumCta="1"/><BCE:Ctas NumCta="2"/></BCE:Balanza>')).toBe(2);
    expect(countRecords('catalogo', '<catalogocuentas:Catalogo><catalogocuentas:Ctas/></catalogocuentas:Catalogo>')).toBe(1);
  });
});
