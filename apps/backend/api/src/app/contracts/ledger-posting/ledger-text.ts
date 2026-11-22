import type { NarrativeRef, NarrativeValue } from '@virtex/shared/types';

/**
 * A narrative the system writes on an entry or a line: the text the books record, and the message
 * and values it was written from (`NarrativeRef`, shared with the client that renders it).
 *
 * The text is the record — written once, in the books language, and what an auditor and a filing
 * read (`LanguageAxis.Books`). The message and its values let a reader in another language see the
 * same narrative in theirs (`LanguageAxis.Interface`) without anything rewriting the record: a US
 * controller reads «Depreciation 2026-10 — AF-2026-000001 Crane» where the books say «Depreciación
 * 2026-10 — AF-2026-000001 Grúa».
 */
export type { NarrativeRef } from '@virtex/shared/types';

/**
 * What a narrative's value may be when it is written: one of the shapes a narrative stores — text,
 * a number, a name kept in several languages, another narrative's message — or a `LedgerText`,
 * which is its text in the books and its message in the stored values. A date goes as its ISO
 * text: a calendar date reads the same in every language.
 */
export type NarrativeInput = NarrativeValue | LedgerText | undefined;

/**
 * What `LedgerNarrativeService` hands back: the text, with the message it came from.
 *
 * It is not a string on purpose, so the compiler finds every place that sets a description and
 * makes it say whether the narrative travels with it (`narrated`). Used inside a longer text — a
 * template literal — it is its text: a composed narrative is not one message, and keeps none.
 */
export class LedgerText {
  constructor(
    readonly text: string,
    readonly ref: NarrativeRef,
  ) {}

  toString(): string {
    return this.text;
  }
}

/** A description and the narrative it was written from, for an entry or a line: spread it into the DTO. */
export function narrated(text: LedgerText): { description: string; narrative: NarrativeRef } {
  return { description: text.text, narrative: text.ref };
}

/**
 * A description for an entry or a line, from what wrote it: a narrative of the system — which
 * keeps its message — or a text a person typed, which is only text. Spread it into the DTO.
 */
export function described(text: LedgerText | string): { description: string; narrative?: NarrativeRef };
export function described(text: LedgerText | string | null | undefined): { description?: string; narrative?: NarrativeRef };
export function described(text: LedgerText | string | null | undefined): { description?: string; narrative?: NarrativeRef } {
  if (text === null || text === undefined) return {};
  return typeof text === 'string' ? { description: text } : { description: text.text, narrative: text.ref };
}

/**
 * A narrative followed by the note a person typed: «Ajuste de inventario — conteo físico». The
 * books keep the whole text; a reader in another language sees the narrative in theirs and the
 * note as it was typed (`ledger.with_note`, the narrative nested in its values).
 */
export function withNote(narrative: LedgerText, note: string | null | undefined): LedgerText {
  const typed = note?.trim();
  if (!typed) return narrative;
  return new LedgerText(`${narrative.text} — ${typed}`, { key: 'ledger.with_note', params: { narrative: narrative.ref, note: typed } });
}
