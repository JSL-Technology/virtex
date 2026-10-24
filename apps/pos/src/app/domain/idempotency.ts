/** A fresh idempotency key: random, one per sale attempt (kept across retries of the same cart). */
export function newIdempotencyKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
