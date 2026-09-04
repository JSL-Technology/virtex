import type { IsoDate } from '../../common/dates';

export interface GeneralLedgerLine {
  id: string;
  date: IsoDate;
  /**
   * The entry's consecutive number, e.g. `GENERAL-2026-000042`.
   *
   * This used to be `'JE-' + entry.id.slice(0, 8)` — eight characters of a uuid, which is neither
   * consecutive nor ordered, and which is exactly what `JournalEntryNumberingService` was
   * introduced to replace. The general ledger kept printing it long after every entry had a real
   * number, so the one book an auditor cross-references against the journal could not be.
   */
  reference: string;
  journalEntryId: string;
  journalCode: string | null;
  description: string;
  debit: number;
  credit: number;
  /** Running balance in the account's natural sense. */
  balance: number;
}

export interface GeneralLedger {
  ledger: { id: string; name: string; currency: string };
  account: {
    id: string;
    code: string;
    name: Record<string, string> | string;
    type: string;
    nature: string;
  };
  startDate: IsoDate;
  endDate: IsoDate;
  initialBalance: number;
  finalBalance: number;
  periodDebit: number;
  periodCredit: number;
  lines: GeneralLedgerLine[];
  /** Paging, because an account's history is unbounded. */
  page: number;
  pageSize: number;
  totalLines: number;
  hasMore: boolean;
}
