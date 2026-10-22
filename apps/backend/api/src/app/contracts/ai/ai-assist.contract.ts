/**
 * What a domain module may ask of the AI platform without depending on it.
 *
 * Accounts payable reads a supplier's invoice, collections drafts a reminder, reconciliation breaks
 * a tie, an import maps its columns: each needs a language model, and none may import the AI module
 * — that would make every domain depend on the one module allowed to depend on most of them. This
 * port is the two questions they actually ask. The AI module implements it (`AiGatewayService`), so
 * every call still pays its credits, is recorded, and goes through the circuit breaker.
 *
 * A model's output is untrusted input: `extract` validates it twice (the API against the schema,
 * then the caller's `validate`), and `compose` is only ever shown to a person before it is sent.
 */

/** The AI features a domain module can use; each has its model, effort and price in the AI module. */
export type AiAssistFeature =
  | 'bill_capture'
  | 'compose'
  | 'column_mapping'
  | 'reconcile_ambiguous'
  | 'deep_analysis';

/** Input content, independent of any provider's wire format. Binary data is base64. */
export type AiAssistContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }
  | { type: 'pdf'; data: string };

export interface AiExtractRequest<T> {
  feature: AiAssistFeature;
  /** Which instructions these are (`bill_capture.system`); recorded with a hash of the text as its version. */
  promptId: string;
  organizationId: string;
  userId: string | null;
  /** Stable instructions, free of per-request values so they can be served from the prompt cache. */
  system: string;
  content: AiAssistContent[];
  /** JSON Schema of the answer; every object needs `additionalProperties: false`. */
  schema: Record<string, unknown>;
  /** Checks what the schema cannot (ids that must exist, totals that must add up) and types it. */
  validate: (value: unknown) => T;
  /** Identifies the input in the audit trail without storing it, e.g. the file's SHA-256. */
  inputFingerprint?: string;
}

export interface AiComposeRequest {
  feature: AiAssistFeature;
  /** Which instructions these are (`collections.reminder`). */
  promptId: string;
  organizationId: string;
  userId: string | null;
  system: string;
  /** What to write, in plain words. */
  instructions: string;
  /**
   * The facts the text may state — amounts, dates, names. The model is told it may not state any
   * other figure, and `compose` checks every number in the answer against these.
   */
  facts: Record<string, string | number | null>;
  language: string;
}

export interface AiAssistResult<T> {
  value: T;
  requestId: string;
  model: string;
}

export abstract class AiAssistPort {
  /** Whether a call can be made now: configured, enabled, and the provider circuit closed. */
  abstract available(): boolean;

  abstract extract<T>(request: AiExtractRequest<T>): Promise<AiAssistResult<T>>;

  /** A short text for a person to review, with a subject line. Figures are checked against `facts`. */
  abstract compose(request: AiComposeRequest): Promise<AiAssistResult<{ subject: string; body: string }>>;
}

/**
 * A cell of a file's sample rows, as it may leave the platform to have its columns recognised.
 *
 * Recognising a column needs its shape — a date, an amount, some words — not its content. E-mail
 * addresses are reduced to their shape, and any run of eight or more digits (an account, card or
 * identifier number) keeps only its last four; amounts, dates and words are left as they are, since
 * they are what tells one column from another.
 */
export function redactSampleCell(value: string): string {
  return value
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, 'x@x.xx')
    .replace(/\d[\d\s-]{6,}\d/g, (run) => {
      // A date written with hyphens is a date, whatever its digit count.
      if (/^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}-\d{1,2}-\d{2,4}$/.test(run)) return run;
      const digits = run.replace(/\D/g, '');
      return digits.length >= 8 ? `•••${digits.slice(-4)}` : run;
    });
}

/** How many sample rows go with a column-recognition request: enough to see a pattern. */
export const SAMPLE_ROWS_SENT = 3;
