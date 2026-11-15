import { roundAmount, sumAmounts } from '../../common/money';

/**
 * The ageing report, for receivables and payables alike.
 *
 * Both modules built it, each with its own copy of the ladder and of the arithmetic that places an
 * amount in its bucket, and the types lived in the payables service — so receivables imported
 * payables to describe its own report. They live here, once, and the two reports are the same
 * report over different documents.
 */

/** One rung of the ladder: days past due, `to` open-ended on the oldest. */
export interface AgingBucket {
  label: string;
  from: number;
  to: number | null;
  amount: number;
}

export interface AgingRow {
  partyId: string;
  partyName: string;
  current: number;
  buckets: AgingBucket[];
  total: number;
}

/**
 * The ageing ladder, plus the one figure that makes it auditable.
 *
 * ## Why the reconciliation line is here
 *
 * The ageing converted each open document at the rate it was **booked** at, while the control
 * account in the general ledger is restated at the closing rate by the period-end revaluation. So
 * from the first revaluation onwards the two disagreed, by a growing amount, with nothing anywhere
 * that would show it — and reconciling the subledger against its control account is the basic
 * substantiation an auditor asks for.
 *
 * The balance in the books' currency is converted at the rate **as of the reporting date**, which is
 * what the revaluation restates it to, and the report states the control account's own balance
 * beside its own total, so the difference is a number on the page rather than something somebody has
 * to discover.
 */
export interface AgingReport {
  asOfDate: string;
  /** The currency every figure below is in: the books'. */
  currencyCode: string;
  rows: AgingRow[];
  totals: { current: number; buckets: AgingBucket[]; total: number };
  /** The control account's balance in the general ledger, on the same date. */
  controlAccountBalance: number;
  /** `total − controlAccountBalance`. Anything but zero is a subledger that needs investigating. */
  controlAccountDifference: number;
  /**
   * False when the report covers only some branches — a branch was asked for, or the reader is
   * limited to some. The general ledger has no branch dimension, so the control-account tie-out
   * only means something for the whole company; a partial report must not present the gap between
   * one store's documents and the company's ledger as a difference to investigate.
   */
  coversWholeCompany: boolean;
  /** Documents whose currency has no rate on file for the reporting date, and are therefore held at the booked rate. */
  unconvertedDocuments: number;
}

/** The standard ageing ladder. Days past due, oldest bucket open-ended. */
export const AGING_BUCKETS: ReadonlyArray<Readonly<Omit<AgingBucket, 'amount'>>> = [
  { label: '1-30', from: 1, to: 30 },
  { label: '31-60', from: 31, to: 60 },
  { label: '61-90', from: 61, to: 90 },
  { label: '90+', from: 91, to: null },
];

const DAY_MS = 86_400_000;

/** Whole days from a document's due date to the cut-off, both calendar dates (`YYYY-MM-DD`). */
export function daysPastDue(dueDate: string, asOfDate: string): number {
  const due = new Date(`${dueDate}T00:00:00.000Z`).getTime();
  const cutoff = new Date(`${asOfDate}T00:00:00.000Z`).getTime();
  return Math.floor((cutoff - due) / DAY_MS);
}

/** A party's row with every rung at zero. */
export function emptyAgingRow(partyId: string, partyName: string): AgingRow {
  return {
    partyId,
    partyName,
    current: 0,
    buckets: AGING_BUCKETS.map((bucket) => ({ ...bucket, amount: 0 })),
    total: 0,
  };
}

/** Adds an amount to a row: to `current` while not yet due, otherwise to the rung its age falls in. */
export function addToAgingRow(row: AgingRow, daysOverdue: number, amount: number): void {
  if (daysOverdue <= 0) {
    row.current = roundAmount(row.current + amount);
  } else {
    const bucket =
      row.buckets.find(
        (candidate) => daysOverdue >= candidate.from && (candidate.to === null || daysOverdue <= candidate.to),
      ) ?? row.buckets[row.buckets.length - 1];
    bucket.amount = roundAmount(bucket.amount + amount);
  }
  row.total = roundAmount(row.total + amount);
}

/** The rows largest first, and the totals line summed over them. */
export function agingRowsAndTotals(rows: Iterable<AgingRow>): Pick<AgingReport, 'rows' | 'totals'> {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  return {
    rows: sorted,
    totals: {
      current: sumAmounts(sorted.map((row) => row.current)),
      buckets: AGING_BUCKETS.map((bucket, index) => ({
        ...bucket,
        amount: sumAmounts(sorted.map((row) => row.buckets[index].amount)),
      })),
      total: sumAmounts(sorted.map((row) => row.total)),
    },
  };
}
