import { DataSource } from 'typeorm';
import { PayrollParametersService } from './payroll-parameters.service';
import { StatutoryContribution } from '../entities/statutory-contribution.entity';
import { IncomeTaxBracket } from '../entities/income-tax-bracket.entity';
import { StatutoryReference } from '../entities/statutory-reference.entity';
import { DominicanRepublicStrategy } from '../../jurisdictions/dominican-republic.strategy';
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

  it('uses RD$23,223 from February 2026, and keeps the old figure for earlier periods', async () => {
    expect((await parameters.resolve('DO', '2026-08-31')).minWageCotizable).toBe(23223);
    expect((await parameters.resolve('DO', '2026-02-01')).minWageCotizable).toBe(23223);
    expect((await parameters.resolve('DO', '2026-01-31')).minWageCotizable).toBe(10000);
  });

  it('caps SFS, AFP and SRL at 10, 20 and 4 times it', async () => {
    const params = await parameters.resolve('DO', '2026-08-31');
    const r = new DominicanRepublicStrategy().computeStatutory(
      { contributoryBase: 150000, taxableEarnings: 150000 },
      params,
    );
    // Below the 232,230 and 464,460 caps, so the whole salary contributes.
    expect(r.sfsEmployee).toBe(4560); // 150,000 × 3.04 % — was 3,040 on a 100,000 base
    expect(r.afpEmployee).toBe(4305); // 150,000 × 2.87 %
    // SRL is capped at 92,892 × 1.10 %.
    expect(r.srlEmployer).toBeCloseTo(1021.81, 2); // was 440 on a 40,000 base
  });

  it('withholds nothing from the salario de Navidad (NOM-03)', async () => {
    const params = await parameters.resolve('DO', '2026-12-15');
    const bonus = new DominicanRepublicStrategy().computeBonus({ bonusAmount: 30000 } as never, params);
    expect(bonus.infotepEmployee).toBe(0);
    expect(bonus.net).toBe(30000);
  });
});
