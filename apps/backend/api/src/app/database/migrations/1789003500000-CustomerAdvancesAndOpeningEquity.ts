import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two accounts every set of books needs, and neither existed.
 *
 *  - **Customer advances (2170, liability).** A collection with nothing applied to it was credited
 *    to the receivable control account, so the asset went negative and the ageing report — which
 *    reconciles the subledger against that very account — reported a difference equal to the money
 *    held in advance. An advance is something owed to the customer, not a negative amount owed by
 *    them.
 *  - **Opening balance equity (3150, equity).** Opening stock, an opening bank balance or a
 *    receivable carried over from a previous system each debit an asset and need a credit that is
 *    not a result this company earned. Retained earnings is the wrong home for it — the treasury
 *    form already says so to the user's face — so the counterpart gets its own account, cleared by
 *    the accountant once the opening balance sheet is agreed.
 *
 * New tenants get both from the chart-of-accounts template. This adds them to the tenants that
 * already exist, in the language their books are kept in, and points the organization's settings
 * at them. Idempotent: a tenant that already has the role keeps the account it has.
 */
export class CustomerAdvancesAndOpeningEquity1789003500000 implements MigrationInterface {
  name = 'CustomerAdvancesAndOpeningEquity1789003500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "default_customer_advances_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "default_opening_balance_equity_account_id" uuid
    `);

    // The books' language decides the account name. `books_language` is null on tenants created
    // before it existed, and those were all provisioned in Spanish.
    const named = (es: string, pt: string, en: string) => `
      CASE COALESCE(o."books_language", 'es')
        WHEN 'pt' THEN jsonb_build_object('pt', '${pt}')
        WHEN 'en' THEN jsonb_build_object('en', '${en}')
        ELSE jsonb_build_object('es', '${es}')
      END`;

    // Each new leaf hangs off the same parent as an account whose role we already know, so it
    // lands in the right group of each tenant's tree rather than at the root.
    const insertLeaf = (
      role: string,
      code: string,
      siblingRole: string,
      type: string,
      category: string,
      nameExpr: string,
    ) => `
      WITH inserted AS (
        INSERT INTO "accounts"
          ("name", "type", "category", "nature", "isActive", "isPostable", "isSystemAccount",
           "parent_id", "organization_id", "system_role", "version", "code")
        SELECT ${nameExpr}, '${type}'::accounts_type_enum, '${category}'::accounts_category_enum,
               'CREDIT'::accounts_nature_enum, true, true, false,
               sibling."parent_id", o."id", '${role}', 1, '${code}'
        FROM "organizations" o
        JOIN "accounts" sibling
          ON sibling."organization_id" = o."id" AND sibling."system_role" = '${siblingRole}'
        WHERE NOT EXISTS (
          SELECT 1 FROM "accounts" a
          WHERE a."organization_id" = o."id" AND a."system_role" = '${role}'
        )
        RETURNING "id"
      )
      INSERT INTO "account_segments" ("order", "value", "account_id")
      SELECT 0, '${code}', "id" FROM inserted
    `;

    await q.query(
      insertLeaf(
        'CUSTOMER_ADVANCES',
        '2170',
        'ACCOUNTS_PAYABLE',
        'LIABILITY',
        'CURRENT_LIABILITY',
        named('Anticipos de Clientes', 'Adiantamentos de Clientes', 'Customer Advances'),
      ),
    );
    await q.query(
      insertLeaf(
        'OPENING_BALANCE_EQUITY',
        '3150',
        'RETAINED_EARNINGS',
        'EQUITY',
        'OWNERS_EQUITY',
        named(
          'Patrimonio por Saldos Iniciales',
          'Património de Saldos Iniciais',
          'Opening Balance Equity',
        ),
      ),
    );

    for (const [column, role] of [
      ['default_customer_advances_account_id', 'CUSTOMER_ADVANCES'],
      ['default_opening_balance_equity_account_id', 'OPENING_BALANCE_EQUITY'],
    ]) {
      await q.query(`
        UPDATE "organization_settings" s
        SET "${column}" = a."id"
        FROM "accounts" a
        WHERE a."organization_id" = s."organization_id"
          AND a."system_role" = '${role}'
          AND s."${column}" IS NULL
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "organization_settings"
        DROP COLUMN IF EXISTS "default_customer_advances_account_id",
        DROP COLUMN IF EXISTS "default_opening_balance_equity_account_id"
    `);
    // Only accounts this migration could have created, and only while they carry no entries.
    await q.query(`
      DELETE FROM "accounts" a
      WHERE a."system_role" IN ('CUSTOMER_ADVANCES', 'OPENING_BALANCE_EQUITY')
        AND NOT EXISTS (
          SELECT 1 FROM "journal_entry_lines" l WHERE l."account_id" = a."id"
        )
    `);
  }
}
