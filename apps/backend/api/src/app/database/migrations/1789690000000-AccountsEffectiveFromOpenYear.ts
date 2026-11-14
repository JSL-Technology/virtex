import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An account is valid from the start of the open fiscal year, not from the day it was created
 * (FIN-COA-01).
 *
 * `accounts.effective_from` defaults to `CURRENT_DATE`, and the opening chart is written the moment
 * a company signs up, so all of its accounts were valid only from that day. A company that signed
 * up in November could not post its opening balances, nor anything else from the year already under
 * way: the temporal guard answered 403 on account 1110 for an entry dated the 2nd, and the only way
 * out was to edit all fifty-six accounts by hand.
 *
 * `ChartOfAccountsService` now resolves the date when nobody gives one. This repairs what is
 * already stored, and only that:
 *
 *  - only rows whose `effective_from` is still the day they were created — the default, untouched.
 *    An account somebody gave a date to keeps it;
 *  - only moving the date BACKWARDS, to the start of the oldest OPEN fiscal year of that same
 *    organization. It widens validity, never narrows it, so no entry that posts today stops
 *    posting tomorrow;
 *  - nothing at all where the organization has no open fiscal year.
 */
export class AccountsEffectiveFromOpenYear1789690000000 implements MigrationInterface {
  name = 'AccountsEffectiveFromOpenYear1789690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "accounts" AS a
         SET "effective_from" = y."start_date"
        FROM (
               SELECT "organization_id", MIN("start_date") AS "start_date"
                 FROM "fiscal_years"
                WHERE "status" = 'OPEN'
                GROUP BY "organization_id"
             ) AS y
       WHERE a."organization_id" = y."organization_id"
         AND a."effective_from" = (a."created_at" AT TIME ZONE 'UTC')::date
         AND a."effective_from" > y."start_date"
    `);
  }

  public async down(): Promise<void> {
    // Irreversible by design: the previous value was the creation date of each row, which is still
    // in `created_at`, but restoring it would re-break every chart this repaired. An account's
    // validity window is editable from the product for the one case where it has to be narrowed.
  }
}
