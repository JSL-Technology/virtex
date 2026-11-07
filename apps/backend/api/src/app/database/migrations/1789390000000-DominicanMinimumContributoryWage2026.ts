import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The TSS minimum contributory wage in force from February 2026 (audit 2026-10-31, NOM-01).
 *
 * The only row was RD$10,000 from 2020 with no end, so every cap derived from it was wrong: SFS
 * capped at 100,000 instead of 232,230, AFP at 200,000 instead of 464,460, SRL at 40,000 instead of
 * 92,892. Above 100,000 a month the payslip withheld too little SFS, so too much ISR, and the
 * employer's SFS and SRL came out short.
 *
 * Added as a new dated version, not an edit: a run for a period before February 2026 keeps the
 * figure it was calculated with (the run snapshots its parameters), and the lookup takes the newest
 * row in force on the period's date. The caps follow from the multipliers already stored on each
 * contribution (SFS ×10, AFP ×20, SRL ×4).
 *
 * Source: TSS, salario mínimo cotizable RD$23,223.00 effective 2026-02-01 (as reported by the TSS
 * and the press, Feb 2026). The intermediate values between 2020 and 2026 are not loaded here:
 * recalculating a closed period of those years needs them added by a platform administrator from
 * the TSS resolutions of each year. TO VERIFY with a Dominican accountant before go-live.
 */
export class DominicanMinimumContributoryWage20261789390000000 implements MigrationInterface {
  name = 'DominicanMinimumContributoryWage20261789390000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "payroll_statutory_references" ("country_code", "key", "effective_from", "value", "currency_code")
      SELECT 'DO', 'MIN_WAGE_COTIZABLE', '2026-02-01', 23223.00, 'DOP'
       WHERE NOT EXISTS (
         SELECT 1 FROM "payroll_statutory_references"
          WHERE "country_code" = 'DO' AND "key" = 'MIN_WAGE_COTIZABLE' AND "effective_from" = '2026-02-01')
    `);
    // The 2020 figure stops where the new one starts, so the history reads as a sequence.
    await q.query(`
      UPDATE "payroll_statutory_references" SET "effective_to" = '2026-01-31'
       WHERE "country_code" = 'DO' AND "key" = 'MIN_WAGE_COTIZABLE' AND "effective_from" = '2020-01-01'
         AND "effective_to" IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "payroll_statutory_references" SET "effective_to" = NULL
       WHERE "country_code" = 'DO' AND "key" = 'MIN_WAGE_COTIZABLE' AND "effective_from" = '2020-01-01'
    `);
    await q.query(`
      DELETE FROM "payroll_statutory_references"
       WHERE "country_code" = 'DO' AND "key" = 'MIN_WAGE_COTIZABLE' AND "effective_from" = '2026-02-01'
    `);
  }
}
