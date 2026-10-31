import { EntityManager } from 'typeorm';

/**
 * The names people are shown by, for a document that records who did something («contado por»,
 * «aprobado por»). Read without importing Identity's user entity, so other modules do not depend on
 * how a user row is laid out.
 */
export async function userDisplayNames(manager: EntityManager, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const rows: Array<{ id: string; firstName: string | null; lastName: string | null }> = await manager.query(
    `SELECT "id", "firstName", "lastName" FROM "users" WHERE "id" = ANY($1::uuid[])`,
    [wanted],
  );
  return new Map(rows.map((row) => [row.id, `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim()]));
}
