import { EntityManager } from 'typeorm';
import { ConflictError } from '../../i18n/localized.exception';

/**
 * A table that may point at the record being deleted.
 *
 * `label` is a catalogue key naming the dependent kind ("facturas", "cobros"…). It travels to the
 * client as a parameter so the refusal can say WHAT is in the way, not just that something is.
 */
export interface DependentReference {
  table: string;
  column: string;
  label: string;
  /** Extra SQL condition on the dependent row (e.g. excluding soft-deleted rows). */
  where?: string;
}

export interface DependentCount {
  label: string;
  count: number;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quote(identifier: string): string {
  if (!IDENTIFIER.test(identifier)) {
    // Identifiers come from code, never from a request; this is a guard against a typo turning
    // into SQL, not an input-validation path.
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

/**
 * How many rows of each kind still point at `id`.
 *
 * One round-trip per reference, inside the caller's transaction, so the answer and the delete see
 * the same snapshot. The queries run under the tenant's row-level-security context like any other,
 * so a count can never include — or reveal — another tenant's rows.
 */
export async function countDependents(
  manager: EntityManager,
  id: string,
  references: readonly DependentReference[],
): Promise<DependentCount[]> {
  const counts: DependentCount[] = [];
  for (const ref of references) {
    const extra = ref.where ? ` AND (${ref.where})` : '';
    const rows: Array<{ count: string | number }> = await manager.query(
      `SELECT COUNT(*)::int AS count FROM ${quote(ref.table)} WHERE ${quote(ref.column)} = $1${extra}`,
      [id],
    );
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) counts.push({ label: ref.label, count });
  }
  return counts;
}

/**
 * Refuse to delete a master record that documents still reference (QA C-03).
 *
 * Deleting a customer used to cascade through the database into its fiscal invoices (with issued
 * e-NCF) and its receipts, leaving their journal entries orphaned and receivables out of balance
 * with the ledger. A product with invoices and a department with employees went the same way.
 * Fiscal documents are legal records: they are voided or credited, never deleted, and so the
 * master data they name cannot disappear from under them either.
 *
 * The database now enforces the same rule (`ON DELETE RESTRICT`, migration
 * `ProtectReferencedMasterData`), and the exception filter turns that violation into a 409 — so a
 * forgotten check still cannot destroy data. This helper exists for the reader: it names what is
 * in the way and how many, and the message offers the alternative (deactivate / archive).
 *
 * @param messageKey  The refusal, worded for the kind of record ("the customer has…").
 */
export async function assertNoDependents(
  manager: EntityManager,
  id: string,
  references: readonly DependentReference[],
  messageKey = 'errors.record_in_use_detail',
): Promise<void> {
  const dependents = await countDependents(manager, id, references);
  if (dependents.length === 0) return;
  throw new ConflictError(
    messageKey,
    // `dependents` carries catalogue keys, not words: the client translates each label and joins
    // them into `{{summary}}` (ErrorHandlerService), so the sentence is in the reader's language.
    { dependents: dependents.map((d) => ({ label: d.label, count: d.count })) },
    // Not `RECORD_IN_USE`: the client resolves `errors.<code>` BEFORE the message key, and the
    // generic sentence for that code would hide the detail this refusal exists to give.
    'DELETE_BLOCKED',
  );
}
