import { isLocalizedName, type LocalizedName } from './localized-name.contract';

/**
 * A narrative the system wrote on a journal entry or a line, kept as the message it came from.
 *
 * ## Why it exists
 *
 * The books record a narrative once, in their own language — «Factura B0100000004 a Cliente QA» —
 * and that text is never rewritten: it is what a filing, an export and an auditor read
 * (`LanguageAxis.Books`). A reader whose language is another one still has to understand their own
 * ledger, so the posting keeps, beside the text, the message and the values it was written from
 * (`description_key`, `description_params`). A screen renders those in the reader's language; the
 * record stays as it was written. No leader re-renders posting texts: they keep one text, in one
 * language.
 *
 * ## What a value can be
 *
 * Judged by shape, never by name, on the server and on the client alike:
 *
 * - **another narrative** — `{ key, params }` — rendered the same way, inside (a reversed line, a
 *   closing that names the fiscal year it closes);
 * - **a name kept in several languages** — `{ es: 'Bancos', en: 'Banks' }` — in the reader's;
 * - **a catalogue key** — `ledger.adjustment_type.accrual` — translated, when the catalogue has it;
 * - **anything else** — a number, a document number, what a person typed — exactly as it was.
 */
export interface NarrativeRef {
  key: string;
  params: Record<string, NarrativeValue>;
}

export type NarrativeValue = string | number | boolean | null | NarrativeRef | LocalizedName;

/** The shape of a catalogue key, `ledger.sales.invoice`: the one the server's messages use too. */
export const MESSAGE_KEY_SHAPE = /^[a-z0-9][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

/** How deep one narrative may nest another — a reversal of a line with a note is three. */
export const NARRATIVE_MAX_DEPTH = 5;

/** Whether a value is a narrative kept as its message: exactly a key and its values. */
export function isNarrativeRef(value: unknown): value is NarrativeRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const params = record['params'];
  return (
    Object.keys(record).length === 2 &&
    typeof record['key'] === 'string' &&
    MESSAGE_KEY_SHAPE.test(record['key']) &&
    params !== null &&
    typeof params === 'object' &&
    !Array.isArray(params)
  );
}

/** What rendering a narrative needs from the runtime that shows it. */
export interface NarrativeRenderer {
  /** The message in the reader's language, or `null` when the catalogue has no such key. */
  message(key: string, values: Record<string, unknown>): string | null;
  /** A name kept in several languages, in the reader's. */
  name(value: LocalizedName): string;
}

/**
 * A narrative rendered in the reader's language, or `null` when it cannot be — a key this build
 * does not have, or nesting deeper than any narrative the product writes. The caller shows the
 * record then: a narrative half in one language is worse than one wholly in the books'.
 */
export function renderNarrative(ref: NarrativeRef, renderer: NarrativeRenderer, depth = 0): string | null {
  if (depth > NARRATIVE_MAX_DEPTH) return null;
  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(ref.params ?? {})) {
    if (isNarrativeRef(value)) {
      const nested = renderNarrative(value, renderer, depth + 1);
      if (nested === null) return null;
      values[name] = nested;
    } else if (isLocalizedName(value)) {
      values[name] = renderer.name(value);
    } else if (typeof value === 'string' && MESSAGE_KEY_SHAPE.test(value)) {
      values[name] = renderer.message(value, {}) ?? value;
    } else {
      values[name] = value;
    }
  }
  return renderer.message(ref.key, values);
}
