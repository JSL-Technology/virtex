import { DataSource } from 'typeorm';
import { PayrollParametersService } from './payroll-parameters.service';
import { StatutoryContribution } from '../entities/statutory-contribution.entity';
import { IncomeTaxBracket } from '../entities/income-tax-bracket.entity';
import { StatutoryReference } from '../entities/statutory-reference.entity';
import { DO_CONTRIBUTION as C, DominicanPayrollEngine } from '../../markets/do/payroll/index';
import { StatutoryResult } from '../../markets/contracts';

const ee = (r: StatutoryResult, code: string) => r.contributions.find((c) => c.code === code)?.employeeAmount ?? 0;
const er = (r: StatutoryResult, code: string) => r.contributions.find((c) => c.code === code)?.employerAmount ?? 0;
import { describeWithDb, openTestDataSource } from '../../common/database/testing/integration-db';

/**
 * NOM-01 (audit 2026-10-31): the seeded minimum contributory wage was RD$10,000 from 2020, so the
 * caps derived from it were a fraction of the real ones. This reads the SEEDED rows — not figures
 * built in the test, which is how the strategy's own spec could never have caught it — and works the
 * audit's case: RD$150,000 a month, August 2026.
 */
describeWithDb('Dominican statutory data as seeded', () => {
  let dataSource: DataSource;
  let parameters: PayrollParametersService;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    parameters = new PayrollParametersService(
      dataSource.getRepository(StatutoryContribution),
      dataSource.getRepository(IncomeTaxBracket),
      dataSource.getRepository(StatutoryReference),
    );
  });
  afterAll(() => dataSource.destroy());

  // NOM-02 (audit 2026-11-07): the seed said RD$10,000 from 2020 to January 2026, and this test
  // asserted it. The series is now the one with a source — TSS figures verified in the audit:
  // 19,351.50 (02/2024), 21,674.80 (04/2025), 23,223.00 (02/2026) — and a period before the first
  // of them is refused rather than computed with caps at less than half their value.
  it('follows the TSS series with its source, and refuses a period with no recorded figure', async () => {
    expect((await parameters.resolve('DO', '2026-08-31')).minWageCotizable).toBe(23223);
    expect((await parameters.resolve('DO', '2026-02-01')).minWageCotizable).toBe(23223);
    expect((await parameters.resolve('DO', '2026-01-31')).minWageCotizable).toBe(21674.8);
    expect((await parameters.resolve('DO', '2025-04-01')).minWageCotizable).toBe(21674.8);
    expect((await parameters.resolve('DO', '2025-03-31')).minWageCotizable).toBe(19351.5);
    expect((await parameters.resolve('DO', '2024-02-01')).minWageCotizable).toBe(19351.5);
    await expect(parameters.resolve('DO', '2024-01-31')).rejects.toMatchObject({
      messageKey: 'payroll.no_minimum_contributory_wage_p1_p2',
    });
  });

  it('caps AFP at 20 × the January 2026 figure, as the audit worked it (433,496)', async () => {
    const params = await parameters.resolve('DO', '2026-01-31');
    const r = new DominicanPayrollEngine().computeStatutory(
      { contributoryBase: 600000, taxableEarnings: 600000 },
      params,
    );
    expect(r.contributions.find((c) => c.code === C.AFP)?.appliedBase).toBe(433496);
    expect(ee(r, C.AFP)).toBeCloseTo(12441.34, 2); // 433,496 × 2.87 %
  });

  it('names the legal basis of every Dominican statutory row', async () => {
    for (const table of ['payroll_statutory_contributions', 'payroll_statutory_references', 'payroll_income_tax_brackets']) {
      const rows = await dataSource.query(`SELECT count(*)::int AS n FROM ${table} WHERE country_code = 'DO' AND (legal_basis IS NULL OR btrim(legal_basis) = '')`);
      expect({ table, missing: rows[0].n }).toEqual({ table, missing: 0 });
    }
  });

  it('caps SFS, AFP and SRL at 10, 20 and 4 times it', async () => {
    const params = await parameters.resolve('DO', '2026-08-31');
    const r = new DominicanPayrollEngine().computeStatutory(
      { contributoryBase: 150000, taxableEarnings: 150000 },
      params,
    );
    // Below the 232,230 and 464,460 caps, so the whole salary contributes.
    expect(ee(r, C.SFS)).toBe(4560); // 150,000 × 3.04 % — was 3,040 on a 100,000 base
    expect(ee(r, C.AFP)).toBe(4305); // 150,000 × 2.87 %
    // SRL is capped at 92,892 × 1.10 %.
    expect(er(r, C.SRL)).toBeCloseTo(1021.81, 2); // was 440 on a 40,000 base
  });

  it('withholds nothing from the salario de Navidad (NOM-03)', async () => {
    const params = await parameters.resolve('DO', '2026-12-15');
    const bonus = new DominicanPayrollEngine().computeBonus({ bonusAmount: 30000 } as never, params);
    expect(bonus.contributions).toEqual([]);
    expect(bonus.net).toBe(30000);
  });
});
