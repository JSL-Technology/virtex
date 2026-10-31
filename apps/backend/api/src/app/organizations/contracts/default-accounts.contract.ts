import { EntityManager } from 'typeorm';

/**
 * Whether the company's settings name the inventory account and the inventory-adjustment account,
 * without other modules importing the settings entity.
 */
export async function inventoryAccountsConfigured(manager: EntityManager, organizationId: string): Promise<boolean> {
  const rows: Array<{ ok: boolean }> = await manager.query(
    `SELECT ("default_inventory_id" IS NOT NULL AND "default_inventory_adjustment_account_id" IS NOT NULL) AS ok
       FROM "organization_settings" WHERE "organization_id" = $1 LIMIT 1`,
    [organizationId],
  );
  return Boolean(rows[0]?.ok);
}
