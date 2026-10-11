/**
 * The rows a raw `RETURNING` gave back, whatever shape `query()` delivered them in.
 *
 * TypeORM's Postgres driver returns the rows themselves for an INSERT or a SELECT, and
 * `[rows, affectedCount]` for an UPDATE or a DELETE. Code written against one shape and run
 * against the other does not fail — it reads the wrong thing quietly:
 *
 *  - the plan quota read `result[0].count` off an UPDATE: `[0]` was the (possibly empty) array of
 *    rows, always truthy, so no usage row was ever inserted, the count came back `undefined`, and
 *    `undefined <= limit` cached «limit reached» for five minutes after the first metered call;
 *  - a backup code was spent by an UPDATE whose result was checked with `.length === 1` — always 2,
 *    the rows and the count — so the code was burnt and the sign-in refused;
 *  - the failed-login counter was read as `NaN` from the same shape.
 *
 * Every raw write that reads its `RETURNING` goes through this, so «which rows did I write» has
 * one answer.
 */
export function returnedRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as T[];
  }
  if (Array.isArray(result)) return result as T[];
  return [];
}
