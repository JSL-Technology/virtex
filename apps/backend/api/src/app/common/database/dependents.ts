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
 * The database enforces the same rule (`NO ACTION DEFERRABLE INITIALLY DEFERRED`, migrations
 * `ProtectReferencedMasterData` and `TenantErasureCompleteness`: checked at commit, so deleting a
 * whole tenant still works), and the exception filter turns that violation into a 409 — so a
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

/**
 * Every reference the SCHEMA declares to `table`, as the dependents that block deleting a row of it.
 *
 * ## Why read the schema instead of listing the tables
 *
 * A hand-written list per service is only right on the day it is written: the next module that
 * adds a table pointing at warehouses or projects does not know the list exists, and deleting the
 * warehouse then fails with a bare constraint error — or, where nothing constrains it, succeeds and
 * orphans the new rows. The foreign keys are already the authoritative statement of what refers to
 * what, and their delete action already says what KIND of reference each one is:
 *
 * - `CASCADE` — the row is part of the parent (a document's lines, a BOM's items): it goes with it
 *   and never blocks.
 * - `SET NULL` — an optional pointer the schema declares may be cleared: it never blocks.
 * - `NO ACTION` / `RESTRICT` — something USES the parent and must not be left dangling: it blocks,
 *   and is named in the refusal.
 *
 * Discovered once per table per process (the schema does not change under a running server) and
 * limited to single-column keys, which is every key this schema has between business tables.
 */
const discovered = new Map<string, Promise<DependentReference[]>>();

export async function discoverReferences(
  manager: EntityManager,
  table: string,
): Promise<DependentReference[]> {
  quote(table);
  let found = discovered.get(table);
  if (!found) {
    found = manager
      .query(
        `SELECT child.relname AS "table", col.attname AS "column"
           FROM pg_constraint k
           JOIN pg_class child ON child.oid = k.conrelid
           JOIN pg_attribute col ON col.attrelid = k.conrelid AND col.attnum = k.conkey[1]
          WHERE k.contype = 'f'
            AND array_length(k.conkey, 1) = 1
            AND k.confrelid = to_regclass($1)
            AND k.confdeltype IN ('a', 'r')
          ORDER BY child.relname, col.attname`,
        [`"${table}"`],
      )
      .then((rows: Array<{ table: string; column: string }>) =>
        rows.map((row) => ({
          table: row.table,
          column: row.column,
          label: `common.dependents.${row.table}`,
        })),
      );
    // A failed lookup is not cached: the next call asks again rather than remembering the error.
    found.catch(() => discovered.delete(table));
    discovered.set(table, found);
  }
  return found;
}

/**
 * Refuse to delete a row that anything in the schema still uses (see `discoverReferences`).
 *
 * `extra` adds references the schema cannot express — a JSON key, a code copied by value — so one
 * call covers both. The refusal has the same shape as `assertNoDependents`, and the client already
 * renders it: what is in the way, how many, and the alternative the message offers.
 */
export async function assertNotInUse(
  manager: EntityManager,
  table: string,
  id: string,
  messageKey = 'errors.record_in_use_detail',
  extra: readonly DependentReference[] = [],
): Promise<void> {
  const references = [...(await discoverReferences(manager, table)), ...extra];
  await assertNoDependents(manager, id, references, messageKey);
}
