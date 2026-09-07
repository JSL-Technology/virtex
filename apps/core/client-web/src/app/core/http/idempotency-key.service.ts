import { Injectable } from '@angular/core';

/**
 * One key per user intention, held until that intention succeeds.
 *
 * ## Why the key cannot be minted per request
 *
 * A key minted when the HTTP call is built is a different key on every call, so two clicks on
 * "Emitir" are two keys, two requests and two postings — exactly what idempotency exists to
 * prevent. The key has to be minted where the intention is formed and survive every attempt at it.
 *
 * ## The lifecycle
 *
 * `keyFor('invoice:issue:abc-123')` returns the same key for that operation until `settle()` is
 * called for it. So:
 *
 *  - Double click → both calls carry one key → the server executes once and replays the answer.
 *  - Network drop after the server committed → the retry carries the same key → replay, not repeat.
 *  - Genuine failure (period closed) → the server releases its side, the caller fixes the cause and
 *    retries with the same key, which is now free again.
 *  - Success → `settle()` drops the key, so the NEXT deliberate issue of the same document is a new
 *    intention and gets a new key.
 *
 * Keys live in memory only. A page reload is a new intention as far as the user is concerned, and
 * persisting them would resurrect a key whose operation may have completed while the tab was gone.
 */
@Injectable({ providedIn: 'root' })
export class IdempotencyKeyService {
  private readonly keys = new Map<string, string>();

  /**
   * The key for this operation, minted on first ask and stable afterwards.
   *
   * @param operation Identifies the intention, not the request: `invoice:issue:<id>`. Two different
   *                  intentions must never share a string, or the second would replay the first.
   */
  keyFor(operation: string): string {
    const existing = this.keys.get(operation);
    if (existing) return existing;

    const key = crypto.randomUUID();
    this.keys.set(operation, key);
    return key;
  }

  /** The operation reached a final state. The next ask starts a new intention. */
  settle(operation: string): void {
    this.keys.delete(operation);
  }
}
