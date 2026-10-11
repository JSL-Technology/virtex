/**
 * Where a journal entry came from, and whether it may be corrected by hand.
 *
 * An entry posted by a document — an invoice, a supplier bill, a payroll run, a goods receipt — is
 * the accounting of that document. Editing it in the journal (which this product does by reversing
 * it and posting a replacement) leaves the document saying one thing and the ledger another: the
 * invoice still owes 7,080 while its receivable now says something else, and nothing ties them back
 * together. Those entries are corrected from their document — a credit note, a void, an adjustment.
 *
 * Entries a person wrote stay editable: the ones with no `systemReason`, and the ones the system
 * only posted on a person's behalf (an approval releasing a manual entry, a recurring template).
 */

/** Reasons that mark an entry a PERSON wrote, merely posted by the system. */
const MANUALLY_AUTHORED_REASONS: ReadonlySet<string> = new Set([
  'approval-granted',
  'recurring-entry',
  'audit-adjustment',
]);

export interface EntryOrigin {
  /** True when the entry belongs to a document and must be corrected there. */
  locked: boolean;
  /** What posted it, as stored (`invoice-issued`, `payroll-run`…), or null for a manual entry. */
  reason: string | null;
  /** The source document, when the entry names one. */
  document: { type: string; id: string; route: string | null } | null;
}

/**
 * Client routes for the documents whose postings carry their id in the idempotency key
 * (`invoice:<id>:revenue`, `payroll:<id>`…). A type without a page is still named, with no link.
 */
const DOCUMENT_ROUTES: Readonly<Record<string, (id: string) => string | null>> = {
  invoice: (id) => `/invoices/${id}`,
  payroll: (id) => `/payroll/runs/${id}`,
  'payroll-payment': (id) => `/payroll/runs/${id}`,
  'inventory-adjustment': (id) => `/inventory/adjustments/${id}`,
  product: (id) => `/inventory/products/${id}/edit`,
  'po-receipt': () => null,
  'bank-rule': () => null,
  'audit-adjustment-close': () => null,
};

export function describeEntryOrigin(entry: {
  systemReason?: string | null;
  idempotencyKey?: string | null;
}): EntryOrigin {
  const reason = entry.systemReason ?? null;
  const locked = reason !== null && !MANUALLY_AUTHORED_REASONS.has(reason);
  return { locked, reason, document: documentOf(entry.idempotencyKey ?? null) };
}

function documentOf(key: string | null): EntryOrigin['document'] {
  if (!key) return null;
  const [type, id] = key.split(':');
  if (!type || !id || !(type in DOCUMENT_ROUTES)) return null;
  return { type, id, route: DOCUMENT_ROUTES[type](id) };
}
