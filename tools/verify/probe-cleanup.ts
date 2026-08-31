import { DataSource } from 'typeorm';

/**
 * Release the fiscal identities a previous verification run is still holding.
 *
 * A verification script that only passes against a virgin database is not a verification script.
 * These probes register real, well-formed fiscal identities — `130862346` is a valid Dominican
 * RNC, `DEM010203AB5` a valid Mexican RFC — and `organizations` carries a unique index on
 * `(tax_id, fiscal_region_id)`. So the first run succeeded and every run after it failed on a
 * duplicate, which from the operator's chair is indistinguishable from the product being broken.
 * Both scripts were in that state: green once, red forever after, on a machine where nothing had
 * regressed.
 *
 * What it does NOT do is delete the tenants. Removing an organization means walking a foreign-key
 * graph that reaches ledgers, hierarchy versions and audit history, and a cleanup routine that has
 * to be kept in step with every new table is a cleanup routine that will be wrong within a month.
 * The unique index is partial — `WHERE tax_id IS NOT NULL` — so clearing the identity is enough to
 * free it, needs one statement, and cannot cascade into anything.
 *
 * The marker is the mailbox: every probe account is created under `@example.test`, a TLD reserved
 * by RFC 6761 for exactly this purpose, which can never belong to a customer. Organizations are
 * reached through it two ways — the members they were created for, and the signup row that
 * produced them — because either one alone can be missing from a tenant a half-finished run left
 * behind, and a tenant this cannot see is a tenant whose fiscal identity stays locked forever.
 *
 * Cleanup runs BEFORE the probes rather than after, so a run that dies half way still leaves a
 * database the next run can use, and so the rows stay inspectable while the failure is being read.
 */
export async function purgeProbeAccounts(ds: DataSource): Promise<number> {
  const released: Array<{ id: string }> = await ds.query(
    `UPDATE "organizations" o
        SET "tax_id" = NULL
      WHERE o."tax_id" IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM "users" u
             WHERE u."organization_id" = o."id"
               AND u."email" LIKE '%@example.test'
          )
          OR EXISTS (
            SELECT 1 FROM "pending_registrations" pr
             WHERE pr."organization_id" = o."id"
               AND pr."email" LIKE '%@example.test'
          )
        )
      RETURNING o."id"`,
  );

  // Signups that never materialised an organization leave only this row behind. It holds the
  // mailbox directly, and nothing references it, so it can simply go.
  await ds.query(
    `DELETE FROM "pending_registrations"
      WHERE "email" LIKE '%@example.test'
        AND "organization_id" IS NULL`,
  );

  return released.length;
}
