import { EntityManager } from 'typeorm';

/** The kinds of treasury account another module may ask about. */
export type TreasuryAccountKind = 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD';

/**
 * Whether a treasury account exists and takes money, read inside the caller's transaction.
 *
 * Sales settle a till's takings into treasury accounts; this keeps them from depending on how
 * treasury lays out its rows.
 */
export async function isActiveTreasuryAccount(
  manager: EntityManager,
  organizationId: string,
  accountId: string,
): Promise<boolean> {
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT "id" FROM "bank_accounts" WHERE "organization_id" = $1 AND "id" = $2 AND "is_active"`,
    [organizationId, accountId],
  );
  return rows.length > 0;
}

/** The company's oldest active treasury account of a kind — its till, its main bank account. */
export async function defaultTreasuryAccount(
  manager: EntityManager,
  organizationId: string,
  kind: TreasuryAccountKind,
): Promise<string | null> {
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT "id" FROM "bank_accounts"
      WHERE "organization_id" = $1 AND "account_type" = $2 AND "is_active"
      ORDER BY "created_at" ASC LIMIT 1`,
    [organizationId, kind],
  );
  return rows[0]?.id ?? null;
}
