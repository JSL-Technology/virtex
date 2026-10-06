import { EntityManager } from 'typeorm';

/** One line of a statement of account: a document, or the undoing of one, on its date. */
export interface StatementMovement {
  date: string;
  /** `invoice`, `credit_note`, `receipt`, `bill`, `payment`, `debit_note`, and their `*_void`. */
  kind: string;
  documentId: string;
  reference: string | null;
  /** Signed in the partner's favour of the company: positive increases what is owed. */
  amount: number;
  /** What is owed after this line. */
  balance: number;
}

export interface PartnerStatement {
  partnerId: string;
  currencyCode: string;
  /** Currencies the partner has documents in: a statement is one currency at a time. */
  currencies: string[];
  from: string;
  to: string;
  openingBalance: number;
  movements: StatementMovement[];
  /** Sum of increases and of decreases within the period. */
  totals: { increases: number; decreases: number };
  closingBalance: number;
}

/**
 * The statement of account of one partner — Odoo's *Partner Ledger*, SAP FBL5N/FBL1N, NetSuite's
 * customer statement — built from the subledger documents rather than the general ledger, whose
 * lines do not carry the partner.
 *
 * `movementsSql` is a SELECT returning `date`, `kind`, `document_id`, `reference`, `amount` and
 * `currency_code` for the partner, using `$1` for the organisation and `$2` for the partner. A
 * document that was voided contributes twice — on its own date and, reversed, on the day it was
 * voided — so the balance on any past date is what it really was that day.
 *
 * @param branchFilterSql an extra predicate on `branch_id` when the reader's branches are limited.
 */
export async function buildPartnerStatement(
  manager: EntityManager,
  args: {
    organizationId: string;
    partnerId: string;
    movementsSql: string;
    params?: unknown[];
    from: string;
    to: string;
    currencyCode: string | null;
    baseCurrency: string;
  },
): Promise<PartnerStatement> {
  const params: unknown[] = [args.organizationId, args.partnerId, ...(args.params ?? [])];
  const currencies: string[] = (
    await manager.query<{ currency_code: string }[]>(
      `SELECT DISTINCT currency_code FROM (${args.movementsSql}) m ORDER BY currency_code`,
      params,
    )
  ).map((row) => row.currency_code);
  const currencyCode =
    args.currencyCode?.toUpperCase() ??
    (currencies.includes(args.baseCurrency) ? args.baseCurrency : (currencies[0] ?? args.baseCurrency));

  const at = params.length;
  const [opening] = await manager.query<{ balance: string | null }[]>(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM (${args.movementsSql}) m
      WHERE currency_code = $${at + 1} AND date < $${at + 2}`,
    [...params, currencyCode, args.from],
  );
  const openingBalance = round(Number(opening?.balance ?? 0));

  const rows = await manager.query<
    { date: string; kind: string; document_id: string; reference: string | null; amount: string; running: string }[]
  >(
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, kind, document_id, reference, amount,
            SUM(amount) OVER (ORDER BY date, sort_key, document_id, kind ROWS UNBOUNDED PRECEDING) AS running
       FROM (SELECT m.*, CASE WHEN m.amount > 0 THEN 0 ELSE 1 END AS sort_key FROM (${args.movementsSql}) m) m
      WHERE currency_code = $${at + 1} AND date BETWEEN $${at + 2} AND $${at + 3}
      ORDER BY date, sort_key, document_id, kind`,
    [...params, currencyCode, args.from, args.to],
  );

  let increases = 0;
  let decreases = 0;
  const movements = rows.map((row) => {
    const amount = round(Number(row.amount));
    if (amount > 0) increases = round(increases + amount);
    else decreases = round(decreases - amount);
    return {
      date: row.date,
      kind: row.kind,
      documentId: row.document_id,
      reference: row.reference,
      amount,
      balance: round(openingBalance + Number(row.running)),
    };
  });

  return {
    partnerId: args.partnerId,
    currencyCode,
    currencies,
    from: args.from,
    to: args.to,
    openingBalance,
    movements,
    totals: { increases, decreases },
    closingBalance: round(openingBalance + increases - decreases),
  };
}

/** `AND branch_id = ANY(...)` for a reader limited to some branches; empty for everyone else. */
export function branchPredicate(allowed: string[] | null, paramIndex: number): { sql: string; params: unknown[] } {
  if (!allowed) return { sql: '', params: [] };
  return { sql: ` AND branch_id = ANY($${paramIndex}::uuid[])`, params: [allowed] };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
