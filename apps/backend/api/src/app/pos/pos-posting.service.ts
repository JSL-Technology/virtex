import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PosSale } from './entities/pos-sale.entity';
import { LedgerPostingLine, LedgerPostingRegistry } from '../contracts/ledger-posting/ledger-posting.contract';
import { organizationPostingAccounts } from '../organizations/contracts/posting-accounts.contract';
import { BadRequestError } from '../i18n/localized.exception';
import { roundAmount, sumAmounts } from '../common/money';

/** What one till sale contributes to the books, split the way the entry needs it. */
export interface PosSalePosting {
  /** Cash that stayed in the drawer (tendered minus change). */
  cash: number;
  /** Card and transfer tenders: money that reaches the bank, not the drawer. */
  nonCash: number;
  /** Revenue from goods and from services, before tax. */
  goodsRevenue: number;
  servicesRevenue: number;
  tax: number;
  /** What the stocked goods cost when they left the warehouse. */
  costOfSale: number;
}

/**
 * Turns a point-of-sale ticket into ledger entries (QA R3-C02).
 *
 * A till sale used to move stock and post nothing: the tills' revenue, the output tax charged on
 * it, the money taken and the cost of the goods were invisible to the trial balance, the income
 * statement, the budget and the 607 — and the inventory account drifted from the warehouse by the
 * cost of every ticket. Each sale now posts, in the transaction that moves its stock:
 *
 * **Revenue** (`VENTAS` journal)
 * ```
 *   Dr  Cash                 cash kept in the drawer
 *   Dr  Bank                 card and transfer tenders
 *       Cr  Sales revenue            goods
 *       Cr  Service revenue          services
 *       Cr  Output tax               tax charged
 * ```
 * **Cost** (`GENERAL` journal), when stocked goods left
 * ```
 *   Dr  Cost of goods sold   /   Cr  Inventory
 * ```
 *
 * A void reverses exactly those two entries, dated the day of the void, alongside the stock it puts
 * back — so a voided ticket nets to nothing in every report, as it does on the shelf.
 *
 * It speaks to accounting only through the ledger-posting contract and reads the default accounts
 * through the organizations contract: sales does not reach into either module's insides.
 */
@Injectable()
export class PosPostingService {
  constructor(private readonly ledger: LedgerPostingRegistry) {}

  /** Post a sale's entries and stamp their ids on it. The caller saves the sale. */
  async post(
    manager: EntityManager,
    sale: PosSale,
    amounts: PosSalePosting,
    date: string,
    actorUserId: string,
  ): Promise<void> {
    const settings = await organizationPostingAccounts(manager, sale.organizationId);
    const cashAccountId = settings?.cashId ?? null;
    const bankAccountId = settings?.bankId ?? cashAccountId;
    if (
      !settings?.salesRevenueId ||
      !settings.salesTaxId ||
      (amounts.cash > 0 && !cashAccountId) ||
      (amounts.nonCash > 0 && !bankAccountId)
    ) {
      // Refused rather than sold off the books: a ticket that cannot post is exactly the defect
      // this service exists to close. The message names what to configure.
      throw new BadRequestError('pos.accounting_setup_incomplete');
    }

    const ticket = sale.id.substring(0, 8).toUpperCase();
    const words = await this.ledger.describeAll(manager, sale.organizationId, {
      header: {
        key: 'ledger.pos.sale',
        params: { ticket, fiscal: sale.fiscalNumber ? ` (${sale.fiscalNumber})` : '', terminal: sale.terminalId },
      },
      cash: { key: 'ledger.pos.cash_in' },
      nonCash: { key: 'ledger.pos.non_cash_in' },
      cost: { key: 'ledger.sales.cost_of_sales' },
      stock: { key: 'ledger.sales.stock_released' },
      costHeader: { key: 'ledger.pos.cost_of', params: { ticket } },
    });

    const lines: LedgerPostingLine[] = [];
    const add = (accountId: string | null | undefined, debit: number, credit: number, description: string) => {
      if (!accountId || roundAmount(debit) + roundAmount(credit) === 0) return;
      lines.push({ accountId, debit: roundAmount(debit), credit: roundAmount(credit), description });
    };
    add(cashAccountId, amounts.cash, 0, words.cash);
    add(bankAccountId, amounts.nonCash, 0, words.nonCash);
    add(settings.salesRevenueId, 0, amounts.goodsRevenue, words.header);
    add(settings.serviceRevenueId ?? settings.salesRevenueId, 0, amounts.servicesRevenue, words.header);
    add(settings.salesTaxId, 0, amounts.tax, words.header);

    const debit = sumAmounts(lines.map((l) => l.debit));
    const credit = sumAmounts(lines.map((l) => l.credit));
    if (Math.abs(debit - credit) > 0.004) {
      throw new BadRequestError('pos.sale_entry_does_not_balance', { debit, credit });
    }

    if (lines.length) {
      const entry = await this.ledger.post(
        manager,
        sale.organizationId,
        {
          journalCode: 'VENTAS',
          date,
          description: words.header,
          currencyCode: settings.baseCurrency ?? undefined,
          exchangeRate: 1,
          lines,
        },
        { actorUserId, module: 'accounts-receivable', systemReason: 'pos-sale', idempotencyKey: `pos-sale:${sale.id}:revenue` },
      );
      sale.journalEntryId = entry.id;
    }

    const cost = roundAmount(amounts.costOfSale);
    if (cost > 0 && settings.costOfGoodsSoldId && settings.inventoryId) {
      const entry = await this.ledger.post(
        manager,
        sale.organizationId,
        {
          journalCode: 'GENERAL',
          date,
          description: words.costHeader,
          currencyCode: settings.baseCurrency ?? undefined,
          exchangeRate: 1,
          lines: [
            { accountId: settings.costOfGoodsSoldId, debit: cost, credit: 0, description: words.cost },
            { accountId: settings.inventoryId, debit: 0, credit: cost, description: words.stock },
          ],
        },
        { actorUserId, module: 'inventory', systemReason: 'pos-sale-cost', idempotencyKey: `pos-sale:${sale.id}:cost` },
      );
      sale.costJournalEntryId = entry.id;
    }
  }

  /** Reverse the sale's entries on the void's date, in the void's transaction. */
  async reverse(manager: EntityManager, sale: PosSale, date: string, reason: string, actorUserId: string): Promise<void> {
    for (const entryId of [sale.journalEntryId, sale.costJournalEntryId]) {
      if (!entryId) continue;
      await this.ledger.reverse(
        manager,
        sale.organizationId,
        entryId,
        { date, reason },
        { actorUserId, module: 'accounts-receivable', systemReason: 'pos-sale-void', idempotencyKey: `pos-void:${sale.id}:${entryId}` },
      );
    }
  }
}
