import { EntityManager } from 'typeorm';

/**
 * Consecutive numbers for any document that needs a gapless-per-year series.
 *
 * `journal_entry_sequences` is keyed by an opaque scope id rather than a foreign key to `journals`,
 * so documents that are not journal entries — a customer receipt, a purchase order, a stock
 * transfer — share the mechanism instead of reimplementing the same `INSERT … ON CONFLICT …
 * RETURNING` beside it. It lives in the platform because every module numbers documents, and none
 * of them should need the general ledger to do it.
 *
 * Runs in the caller's transaction: a document that rolls back gives its number back.
 *
 * @param scopeId what the series belongs to: a journal, or one of `DOCUMENT_SEQUENCE_SCOPE`.
 * @param prefix the human-facing prefix, e.g. `GENERAL` or `REC`.
 */
export async function allocateDocumentNumber(
  manager: EntityManager,
  organizationId: string,
  scopeId: string,
  prefix: string,
  year: number,
): Promise<string> {
  const [row] = await manager.query<{ last_number: number }[]>(
    `INSERT INTO "journal_entry_sequences"
       ("organization_id", "journal_id", "year", "last_number")
     VALUES ($1, $2, $3, 1)
     ON CONFLICT ("organization_id", "journal_id", "year") DO UPDATE
       SET "last_number" = "journal_entry_sequences"."last_number" + 1
     RETURNING "last_number"`,
    [organizationId, scopeId, year],
  );
  return `${prefix}-${year}-${String(row.last_number).padStart(6, '0')}`;
}

/**
 * Reserved scope ids for series that do not belong to a journal.
 *
 * Fixed UUIDs rather than magic strings so they cannot collide with a real journal id, and so the
 * column keeps its uuid type.
 */
export const DOCUMENT_SEQUENCE_SCOPE = {
  /** Customer receipts: `REC-2026-000042`. */
  CUSTOMER_RECEIPT: '00000000-0000-4000-8000-000000000001',
  /** Purchase requisitions: `REQ-2026-000042`. */
  PURCHASE_REQUISITION: '00000000-0000-4000-8000-000000000002',
  /** Purchase orders: `PO-2026-000042`. */
  PURCHASE_ORDER: '00000000-0000-4000-8000-000000000003',
  /** Inventory adjustments: `AJ-2026-000042`. */
  INVENTORY_ADJUSTMENT: '00000000-0000-4000-8000-000000000004',
  /** Transfers between warehouses: `TR-2026-000042`. */
  STOCK_TRANSFER: '00000000-0000-4000-8000-000000000005',
} as const;
