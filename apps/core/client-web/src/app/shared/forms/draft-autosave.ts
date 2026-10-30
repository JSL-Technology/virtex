/**
 * Unsaved work, kept in the browser until it is saved or discarded.
 *
 * A form whose tab survives a reload — the workspace restores tabs, dirty mark included — came
 * back empty: the tab said «unsaved changes» over a blank form, because the changes lived only in
 * memory. This keeps a copy per document in `localStorage`, so a reload, a crash or an expired
 * session gives the person their work back instead of a promise that it existed.
 *
 * What it is not: a save. Nothing reaches the server; the copy is offered back to the same person
 * in the same browser, and it is dropped when the document is saved, discarded, or older than
 * {@link DRAFT_TTL_MS}. Storage being unavailable (private mode, quota) degrades to the old
 * behaviour rather than breaking the form.
 */
export interface StoredDraft<T> {
  value: T;
  /** Epoch milliseconds. */
  savedAt: number;
}

/** A week: long enough to survive a weekend, short enough not to resurrect last month's typo. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = 'virtex.draft.';

export class DraftAutosave<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** `key` names the document: its kind, its company and its id (or `new`). */
  constructor(
    private readonly key: string,
    private readonly delayMs = 400,
  ) {}

  /** The stored copy, if one exists and is fresh. */
  load(): StoredDraft<T> | null {
    try {
      const raw = globalThis.localStorage?.getItem(PREFIX + this.key);
      if (!raw) return null;
      const stored = JSON.parse(raw) as StoredDraft<T>;
      if (!stored || typeof stored.savedAt !== 'number' || Date.now() - stored.savedAt > DRAFT_TTL_MS) {
        this.clear();
        return null;
      }
      return stored;
    } catch {
      return null;
    }
  }

  /** Keeps `value`, debounced: called on every keystroke, it writes once the typing pauses. */
  save(value: T): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        globalThis.localStorage?.setItem(PREFIX + this.key, JSON.stringify({ value, savedAt: Date.now() } satisfies StoredDraft<T>));
      } catch {
        // Storage full or blocked: the form keeps working, it just cannot be recovered.
      }
    }, this.delayMs);
  }

  /** Forgets the copy: the document was saved or the person chose to discard it. */
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      globalThis.localStorage?.removeItem(PREFIX + this.key);
    } catch {
      // Nothing to forget.
    }
  }
}
