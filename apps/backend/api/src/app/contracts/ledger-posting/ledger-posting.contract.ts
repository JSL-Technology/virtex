import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Posting to the general ledger, for modules that must not depend on accounting's insides.
 *
 * A subledger — a till sale, say — has to post its entry in its own transaction, so the posting is
 * a call, not an event. It used to import the journal-entries posting port, its DTOs, its
 * narrative and its journal lookup directly: four private imports and a module dependency from
 * sales into accounting for one feature. Accounting now registers this gateway when it starts (the
 * dependency points from accounting to here), and a caller speaks only this vocabulary: accounts,
 * amounts, a journal by code, catalogue keys for the words.
 */

/** Which subledger is posting: its own period window must be open, as well as the ledger's. */
export type LedgerPostingModule = 'general-ledger' | 'accounts-payable' | 'accounts-receivable' | 'inventory';

export interface LedgerPostingLine {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface LedgerPostingRequest {
  /** The journal by its code (`VENTAS`, `GENERAL`); the gateway resolves it for the company. */
  journalCode: string;
  /** The entry's date, `YYYY-MM-DD`, in the company's calendar. */
  date: string;
  description: string;
  currencyCode?: string;
  exchangeRate?: number;
  lines: LedgerPostingLine[];
}

export interface LedgerPostingContext {
  actorUserId?: string | null;
  /** Why the system posted it — recorded on the entry. */
  systemReason: string;
  /** The same key posts once, however many times the caller retries. */
  idempotencyKey?: string;
  module?: LedgerPostingModule;
}

/** Words in the books' language, from catalogue keys. */
export type LedgerWords<K extends string> = Record<K, { key: string; params?: Record<string, unknown> }>;

export interface LedgerPostingGateway {
  /** Post one balanced entry on the caller's transaction. */
  post(
    manager: EntityManager,
    organizationId: string,
    request: LedgerPostingRequest,
    context: LedgerPostingContext,
  ): Promise<{ id: string }>;
  /** Reverse an entry on the caller's transaction, dated `date`. */
  reverse(
    manager: EntityManager,
    organizationId: string,
    entryId: string,
    reversal: { date: string; reason: string },
    context: LedgerPostingContext,
  ): Promise<void>;
  /** Render catalogue keys in the company's books language. */
  describeAll<K extends string>(manager: EntityManager, organizationId: string, words: LedgerWords<K>): Promise<Record<K, string>>;
}

@Injectable()
export class LedgerPostingRegistry implements LedgerPostingGateway {
  private gateway: LedgerPostingGateway | null = null;

  provide(gateway: LedgerPostingGateway): void {
    this.gateway = gateway;
  }

  available(): boolean {
    return this.gateway !== null;
  }

  post(...args: Parameters<LedgerPostingGateway['post']>): ReturnType<LedgerPostingGateway['post']> {
    return this.require().post(...args);
  }

  reverse(...args: Parameters<LedgerPostingGateway['reverse']>): ReturnType<LedgerPostingGateway['reverse']> {
    return this.require().reverse(...args);
  }

  describeAll<K extends string>(manager: EntityManager, organizationId: string, words: LedgerWords<K>): Promise<Record<K, string>> {
    return this.require().describeAll(manager, organizationId, words);
  }

  /** Accounting not loaded is a wiring error, not a sale to let through unposted. */
  private require(): LedgerPostingGateway {
    if (!this.gateway) throw new Error('No ledger posting gateway is registered: the accounting module is not loaded.');
    return this.gateway;
  }
}
