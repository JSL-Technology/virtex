import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PosSale } from './entities/pos-sale.entity';
import { AccountingPostingPort, ModuleSlug } from '../journal-entries/accounting-posting.port';
import { CreateJournalEntryLineDto } from '../journal-entries/dto/create-journal-entry.dto';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
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
 */
@Injectable()
export class PosPostingService {
  constructor(
    private readonly posting: AccountingPostingPort,
    private readonly narrative: LedgerNarrativeService,
    private readonly orgSettings: OrgSettingsService,
    private readonly journalLookup: JournalLookupService,
  ) {}

  /** Post a sale's entries and stamp their ids on it. The caller saves the sale. */
  async post(
    manager: EntityManager,
    sale: PosSale,
    amounts: PosSalePosting,
    date: string,
    actorUserId: string,
  ): Promise<void> {
    const settings = await this.orgSettings.getForOrg(sale.organizationId, manager);
    const cashAccountId = settings?.defaultCashId ?? null;
    const bankAccountId = settings?.defaultBankId ?? cashAccountId;
    if (
      !settings?.defaultSalesRevenueId ||
      !settings.defaultSalesTaxId ||
      (amounts.cash > 0 && !cashAccountId) ||
      (amounts.nonCash > 0 && !bankAccountId)
    ) {
      // Refused rather than sold off the books: a ticket that cannot post is exactly the defect
      // this service exists to close. The message names what to configure.
      throw new BadRequestError('pos.accounting_setup_incomplete');
    }

    const ticket = sale.id.substring(0, 8).toUpperCase();
    const words = await this.narrative.describeAll(manager, sale.organizationId, {
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

    const lines: CreateJournalEntryLineDto[] = [];
    const add = (accountId: string | null | undefined, debit: number, credit: number, description: string) => {
      if (!accountId || roundAmount(debit) + roundAmount(credit) === 0) return;
      lines.push({ accountId, debit: roundAmount(debit), credit: roundAmount(credit), description });
    };
    add(cashAccountId, amounts.cash, 0, words.cash);
    add(bankAccountId, amounts.nonCash, 0, words.nonCash);
    add(settings.defaultSalesRevenueId, 0, amounts.goodsRevenue, words.header);
    add(settings.defaultServiceRevenueId ?? settings.defaultSalesRevenueId, 0, amounts.servicesRevenue, words.header);
    add(settings.defaultSalesTaxId, 0, amounts.tax, words.header);

    const debit = sumAmounts(lines.map((l) => l.debit));
    const credit = sumAmounts(lines.map((l) => l.credit));
    if (Math.abs(debit - credit) > 0.004) {
      throw new BadRequestError('pos.sale_entry_does_not_balance', { debit, credit });
    }

    if (lines.length) {
      const sales = await this.requireJournal(manager, sale.organizationId, 'VENTAS');
      const entry = await this.posting.createWithManager(
        manager,
        {
          date: new Date(`${date}T00:00:00.000Z`).toISOString(),
          description: words.header,
          journalId: sales.id,
          currencyCode: settings.baseCurrency,
          exchangeRate: 1,
          lines,
        },
        sale.organizationId,
        { actorUserId, module: ModuleSlug.AR, systemReason: 'pos-sale', idempotencyKey: `pos-sale:${sale.id}:revenue` },
      );
      sale.journalEntryId = entry.id;
    }

    const cost = roundAmount(amounts.costOfSale);
    if (cost > 0 && settings.defaultCostOfGoodsSoldId && settings.defaultInventoryId) {
      const general = await this.requireJournal(manager, sale.organizationId, 'GENERAL');
      const entry = await this.posting.createWithManager(
        manager,
        {
          date: new Date(`${date}T00:00:00.000Z`).toISOString(),
          description: words.costHeader,
          journalId: general.id,
          currencyCode: settings.baseCurrency,
          exchangeRate: 1,
          lines: [
            { accountId: settings.defaultCostOfGoodsSoldId, debit: cost, credit: 0, description: words.cost },
            { accountId: settings.defaultInventoryId, debit: 0, credit: cost, description: words.stock },
          ],
        },
        sale.organizationId,
        { actorUserId, module: ModuleSlug.INVENTORY, systemReason: 'pos-sale-cost', idempotencyKey: `pos-sale:${sale.id}:cost` },
      );
      sale.costJournalEntryId = entry.id;
    }
  }

  /** Reverse the sale's entries on the void's date, in the void's transaction. */
  async reverse(manager: EntityManager, sale: PosSale, date: string, reason: string, actorUserId: string): Promise<void> {
    for (const entryId of [sale.journalEntryId, sale.costJournalEntryId]) {
      if (!entryId) continue;
      await this.posting.createSystemReversal(
        entryId,
        sale.organizationId,
        { reversalDate: date, reason },
        manager,
        { actorUserId, module: ModuleSlug.AR, systemReason: 'pos-sale-void', idempotencyKey: `pos-void:${sale.id}:${entryId}` },
      );
    }
  }

  private async requireJournal(manager: EntityManager, organizationId: string, code: string) {
    const journal = await this.journalLookup.findByCode(organizationId, code, manager);
    if (!journal) throw new BadRequestError('invoices.no_journal_code_organization_create_under', { code });
    return journal;
  }
}
