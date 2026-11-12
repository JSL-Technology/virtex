import { Injectable } from '@nestjs/common';
import { Between, DataSource, EntityManager, IsNull, Not } from 'typeorm';
import type {
  ReturnAccountRecord,
  ReturnDataset,
  ReturnFiler,
  ReturnJournalRecord,
  ReturnPeriod,
  ReturnPurchaseRecord,
  ReturnSalesRecord,
  ReturnSettlement,
} from '../../markets/contracts';
import { marketFor } from '../../markets';
import { CancellationMode, Invoice, InvoiceStatus, InvoiceType, PaymentMethod } from '../../invoices/entities/invoice.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { Account, AccountType } from '../../chart-of-accounts/entities/account.entity';
import { AccountNature } from '../../chart-of-accounts/enums/account-enums';
import { JournalEntry } from '../../journal-entries/entities/journal-entry.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { AccountBalancesService, toIsoDate } from '../../chart-of-accounts/account-balances.service';
import { LEDGER_STATUS_VALUES } from '../../contracts/accounting/ledger-statuses.contract';
import { PurchaseFiscalRecordsRegistry } from '../../contracts/fiscal-records/purchase-fiscal-records.registry';
import { PayrollFiscalRecordsRegistry } from '../../contracts/fiscal-records/payroll-fiscal-records.registry';
import type { PurchaseFiscalDocument } from '../../contracts/fiscal-records/purchase-fiscal-records.contract';
import { organizationTimeZone } from '../../shared/fiscal-clock';
import { roundAmount } from '../../common/money';
import { BadRequestError } from '../../i18n/localized.exception';

/** What one period's dataset is built for. */
export interface ReturnDatasetScope {
  organization: Organization;
  year: number;
  /** 1–12. */
  month: number;
  /** Which ledger the bookkeeping filings read; the company's default one when not stated. */
  ledgerId?: string;
}

/**
 * The period's facts, as plain data, for a market's return generator to read.
 *
 * This is the whole of what the core contributes to a return: it knows where an invoice, a supplier
 * comprobante, an account's balance and a journal entry are kept, and nothing about any authority's
 * file. Each part is loaded when a generator asks for it and remembered, so the 606 never loads a
 * journal entry and the Balanza never loads an invoice (docs/ARQUITECTURA_MERCADOS.md, fase 5).
 */
@Injectable()
export class ReturnDatasetFactory {
  constructor(
    private readonly dataSource: DataSource,
    /** The ledger's own figures, so a bookkeeping filing and the statements cannot disagree. */
    private readonly balances: AccountBalancesService,
    /** Purchasing's answer for the purchases returns, without importing its tables. */
    private readonly purchaseRecords: PurchaseFiscalRecordsRegistry,
    /** Payroll's answer for the social-security filings, for the same reason. */
    private readonly payrollRecords: PayrollFiscalRecordsRegistry,
  ) {}

  of(scope: ReturnDatasetScope): ReturnDataset {
    const { organization } = scope;
    const period = monthPeriod(scope.year, scope.month);
    const filer: ReturnFiler = {
      taxId: organization.taxId ?? '',
      legalName: organization.legalName ?? '',
      country: (organization.country ?? '').toUpperCase(),
      fiscalProfile: (organization.fiscalProfile ?? {}) as Readonly<Record<string, string>>,
    };

    const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
      let pending: Promise<T> | null = null;
      return () => (pending ??= load());
    };

    return {
      filer,
      period,
      sales: once(() => this.sales(scope, period)),
      purchases: once(() => this.purchases(scope, period)),
      foreignPurchases: once(() => this.foreignPurchases(scope, period, filer.country)),
      accounts: once(() => this.accounts(scope, period)),
      journals: once(() => this.journals(scope, period)),
      payslips: once(() => this.payslips(scope, period)),
      employeeEvents: once(() => this.employeeEvents(scope, period)),
    };
  }

  // ── What the company issued ────────────────────────────────────────────────

  /**
   * Every document of the period that carries a fiscal number: the ones issued from a document
   * screen first, then the till tickets, each in its own date order — the order the files are read
   * in.
   *
   * A document a credit note reversed in full is here as a sale, not as an annulment: it was a sale
   * of its period and its note reports the reversal, so leaving it out would subtract the sale
   * twice. Only one voided any other way is annulled.
   */
  private async sales(scope: ReturnDatasetScope, period: ReturnPeriod): Promise<ReturnSalesRecord[]> {
    const manager = this.dataSource.manager;
    const organizationId = scope.organization.id;

    const documents = await manager.find(Invoice, {
      relations: ['customer'],
      where: {
        organizationId,
        issueDate: Between(period.from, period.to),
        fiscalNumber: Not(IsNull()),
        status: Not(InvoiceStatus.DRAFT),
      },
      order: { issueDate: 'ASC', invoiceNumber: 'ASC' },
    });

    const [modified, withholdings] = await Promise.all([
      this.modifiedFiscalNumbers(manager, organizationId, documents),
      this.collectedWithholdings(manager, organizationId, period),
    ]);

    const records = documents.map((document): ReturnSalesRecord => {
      const withheld = withholdings.get(document.id);
      return {
        fiscalNumber: document.fiscalNumber ?? '',
        documentType: document.fiscalDocumentType ?? null,
        issueDate: isoDate(document.issueDate),
        counterpartyTaxId: document.customerTaxId ?? document.customer?.taxId ?? null,
        counterpartyName: document.customerName ?? document.customer?.companyName ?? null,
        modifiedFiscalNumber: document.originalInvoiceId ? modified.get(document.originalInvoiceId) ?? null : null,
        netAmount: round(Number(document.subtotal ?? 0) - Number(document.discountTotal ?? 0)),
        taxAmount: round(document.tax),
        // The document-level figure the tax engine stored, never a sum over lines: the relation is
        // not loaded here, so a reduction over it would silently report zero.
        exciseAmount: round(document.excise),
        otherTaxes: 0,
        serviceCharge: round(document.serviceCharge),
        total: round(document.total),
        taxWithheld: withheld?.tax ?? 0,
        incomeTaxWithheld: withheld?.incomeTax ?? 0,
        withheldOn: withheld?.date ?? null,
        settlement: settlementOf(document),
        annulled: document.status === InvoiceStatus.VOID && document.cancellationMode !== CancellationMode.CREDIT_NOTE,
        annulmentCode: document.cancellationReasonCode ?? null,
        annulmentReason: document.voidReason ?? null,
        origin: 'DOCUMENT',
      };
    });

    return [...records, ...(await this.tillSales(scope, period))];
  }

  /**
   * The month's till tickets that carry a fiscal number, dated in the company's fiscal time zone
   * (QA R3-C02). Read straight from the tills' journal so the fiscal module does not depend on the
   * point-of-sale module's entities.
   */
  private async tillSales(scope: ReturnDatasetScope, period: ReturnPeriod): Promise<ReturnSalesRecord[]> {
    const timeZone = organizationTimeZone(scope.organization);
    const rows: Array<{
      fiscal_number: string;
      fiscal_document_type: string | null;
      sale_date: string;
      items: Array<{ lineSubtotal: number; isService?: boolean }>;
      tax: string;
      total: string;
      change_due: string;
      payments: Array<{ method: string; amount: number }>;
      payment_method: string | null;
      status: string;
      void_reason: string | null;
    }> = await this.dataSource.query(
      // pos_sales mixes naming conventions: "createdAt" and "paymentMethod" are camelCase columns.
      // Written as snake_case they made this query fail, so the Dominican returns answered 500 for
      // every tenant (audit 2026-11-07, FAC-CMP-01). `compliance-till-sales.spec.ts` runs it
      // against the real schema so a rename cannot slip past again.
      `SELECT fiscal_number, fiscal_document_type,
              to_char("createdAt" AT TIME ZONE $2, 'YYYY-MM-DD') AS sale_date, items, tax, total,
              change_due, payments, "paymentMethod" AS payment_method, status, void_reason
         FROM pos_sales
        WHERE organization_id = $1 AND fiscal_number IS NOT NULL
          AND ("createdAt" AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
        ORDER BY "createdAt"`,
      [scope.organization.id, timeZone, period.from, period.to],
    );

    return rows.map((row): ReturnSalesRecord => {
      const items = row.items ?? [];
      const net = items.reduce((sum, item) => sum + Number(item.lineSubtotal ?? 0), 0);
      const settlement = { ...NO_SETTLEMENT };
      const payments = row.payments?.length
        ? row.payments
        : [{ method: row.payment_method ?? 'cash', amount: Number(row.total) + Number(row.change_due) }];
      for (const payment of payments) {
        const method = (['cash', 'card', 'transfer'] as const).find((m) => m === payment.method) ?? 'other';
        settlement[method] += Number(payment.amount);
      }
      // Change always comes out of the cash tendered.
      settlement.cash = Math.max(0, settlement.cash - Number(row.change_due));

      return {
        fiscalNumber: row.fiscal_number,
        documentType: row.fiscal_document_type,
        issueDate: row.sale_date,
        counterpartyTaxId: null,
        counterpartyName: null,
        modifiedFiscalNumber: null,
        netAmount: round(net),
        taxAmount: round(Number(row.tax)),
        exciseAmount: 0,
        otherTaxes: 0,
        serviceCharge: 0,
        total: round(Number(row.total)),
        taxWithheld: 0,
        incomeTaxWithheld: 0,
        withheldOn: null,
        settlement,
        annulled: row.status !== 'PAID',
        annulmentCode: null,
        annulmentReason: row.void_reason,
        origin: 'TILL',
      };
    });
  }

  /**
   * The fiscal number of every document modified by a note in the batch.
   *
   * A note stores the UUID of what it modifies; a return reports the authority's NUMBER. Emitting
   * the UUID produced a column of primary keys.
   */
  private async modifiedFiscalNumbers(
    manager: EntityManager,
    organizationId: string,
    documents: readonly Invoice[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        documents
          .filter((document) => document.type !== InvoiceType.INVOICE && document.originalInvoiceId)
          .map((document) => document.originalInvoiceId as string),
      ),
    ];
    const map = new Map<string, string>();
    if (!ids.length) return map;

    const originals = await manager
      .createQueryBuilder(Invoice, 'invoice')
      .select(['invoice.id', 'invoice.fiscalNumber'])
      .where('invoice.organization_id = :organizationId AND invoice.id IN (:...ids)', { organizationId, ids })
      .getMany();
    for (const original of originals) {
      if (original.fiscalNumber) map.set(original.id, original.fiscalNumber);
    }
    return map;
  }

  /**
   * What customers withheld from us on the period's documents, from the receipts that carried it.
   *
   * The withholding happens when the customer pays, not when we issue, so the amounts and the date
   * come from the receipts. A voided receipt withheld nothing.
   */
  private async collectedWithholdings(
    manager: EntityManager,
    organizationId: string,
    period: ReturnPeriod,
  ): Promise<Map<string, { tax: number; incomeTax: number; date: string }>> {
    const rows: Array<{ invoice_id: string; tax: string; income_tax: string; withheld_on: string }> = await manager.query(
      `SELECT l.invoice_id,
              SUM(l.tax_withheld)::text AS tax,
              SUM(l.income_tax_withheld)::text AS income_tax,
              to_char(MAX(p.payment_date), 'YYYY-MM-DD') AS withheld_on
         FROM customer_payment_lines l
         JOIN customer_payments p ON p.id = l.payment_id
         JOIN invoices i ON i.id = l.invoice_id
        WHERE p.organization_id = $1 AND i.organization_id = $1
          AND p.status <> 'VOID'
          AND i."issueDate" BETWEEN $2 AND $3
          AND (l.tax_withheld <> 0 OR l.income_tax_withheld <> 0)
        GROUP BY l.invoice_id`,
      [organizationId, period.from, period.to],
    );
    return new Map(
      rows.map((row) => [
        row.invoice_id,
        { tax: Number(row.tax), incomeTax: Number(row.income_tax), date: row.withheld_on },
      ]),
    );
  }

  // ── What the company received ─────────────────────────────────────────────

  private async purchases(scope: ReturnDatasetScope, period: ReturnPeriod): Promise<ReturnPurchaseRecord[]> {
    const documents = await this.purchaseRecords
      .source()
      .fiscalDocuments({ organizationId: scope.organization.id, from: period.from, to: period.to });
    return documents.map(purchaseRecord);
  }

  private async foreignPurchases(
    scope: ReturnDatasetScope,
    period: ReturnPeriod,
    homeCountry: string,
  ): Promise<ReturnPurchaseRecord[]> {
    const documents = await this.purchaseRecords
      .source()
      .foreignPurchases({ organizationId: scope.organization.id, from: period.from, to: period.to }, homeCountry);
    return documents.map(purchaseRecord);
  }

  // ── What the books say ────────────────────────────────────────────────────

  private async accounts(scope: ReturnDatasetScope, period: ReturnPeriod): Promise<ReturnAccountRecord[]> {
    const manager = this.dataSource.manager;
    const organizationId = scope.organization.id;
    const ledgerId = await this.ledgerOf(scope);
    const language = booksLanguageOf(scope.organization.country);

    const [accounts, rows] = await Promise.all([
      manager.find(Account, { where: { organizationId }, order: { code: 'ASC' } }),
      this.balances.trialBalance({ organizationId, ledgerId, from: period.from, to: period.to }, manager),
    ]);
    const byAccount = new Map(rows.map((row) => [row.accountId, row]));

    return accounts.map((account): ReturnAccountRecord => {
      const row = byAccount.get(account.id);
      return {
        code: account.code,
        name: accountName(account, language),
        nature: natureOf(account),
        groupingCode: account.fiscalGroupingCode?.trim() || null,
        openingBalance: row?.openingBalance ?? 0,
        debit: row?.debit ?? 0,
        credit: row?.credit ?? 0,
        closingBalance: row?.closingBalance ?? 0,
      };
    });
  }

  private async journals(scope: ReturnDatasetScope, period: ReturnPeriod): Promise<ReturnJournalRecord[]> {
    const manager = this.dataSource.manager;
    const ledgerId = await this.ledgerOf(scope);
    const language = booksLanguageOf(scope.organization.country);

    const entries = await manager
      .createQueryBuilder(JournalEntry, 'entry')
      .innerJoinAndSelect('entry.lines', 'line')
      .innerJoinAndSelect('line.valuations', 'valuation', 'valuation.ledgerId = :ledgerId', { ledgerId })
      .innerJoinAndSelect('line.account', 'account')
      .where('entry.organizationId = :organizationId', { organizationId: scope.organization.id })
      .andWhere('entry.status IN (:...ledgerStatuses)', { ledgerStatuses: LEDGER_STATUS_VALUES })
      .andWhere('entry.date BETWEEN :from AND :to', { from: period.from, to: period.to })
      .orderBy('entry.date', 'ASC')
      .addOrderBy('entry.entryNumber', 'ASC')
      .getMany();

    return entries
      // An entry with no number has not been posted and is not part of a filing.
      .filter((entry) => entry.entryNumber)
      .map((entry) => ({
        number: entry.entryNumber as string,
        date: toIsoDate(entry.date),
        description: entry.description ?? '',
        lines: entry.lines
          .map((line) => ({ line, valuation: line.valuations?.[0] }))
          .filter((pair) => pair.valuation)
          .map(({ line, valuation }) => ({
            accountCode: line.account?.code ?? '',
            accountName: line.account ? accountName(line.account, language) : '',
            description: line.description ?? '',
            debit: Number(valuation?.debit ?? 0),
            credit: Number(valuation?.credit ?? 0),
          })),
      }));
  }

  // ── What the company paid its people ──────────────────────────────────────

  private async payslips(scope: ReturnDatasetScope, period: ReturnPeriod) {
    return this.payrollRecords.source().payslips(this.payrollQuery(scope, period));
  }

  private async employeeEvents(scope: ReturnDatasetScope, period: ReturnPeriod) {
    return this.payrollRecords.source().events(this.payrollQuery(scope, period));
  }

  private payrollQuery(scope: ReturnDatasetScope, period: ReturnPeriod) {
    return {
      organizationId: scope.organization.id,
      from: period.from,
      to: period.to,
      year: period.year,
      month: period.month,
    };
  }

  private async ledgerOf(scope: ReturnDatasetScope): Promise<string> {
    if (scope.ledgerId) return scope.ledgerId;
    const ledger = await this.dataSource.manager.findOneBy(Ledger, {
      organizationId: scope.organization.id,
      isDefault: true,
    });
    if (!ledger) throw new BadRequestError('compliance.organization_has_no_default_ledger');
    return ledger.id;
  }
}

const NO_SETTLEMENT: ReturnSettlement = Object.freeze({
  cash: 0,
  transfer: 0,
  card: 0,
  credit: 0,
  giftCard: 0,
  swap: 0,
  other: 0,
});

/**
 * How the document was settled, split across the methods the product records.
 *
 * One method per document, so the whole amount lands in its column; the others are zero, which is
 * not the same as absent — a positional record still has to carry them.
 */
function settlementOf(invoice: Invoice): ReturnSettlement {
  const amount = round(invoice.total);
  switch (invoice.paymentMethod) {
    case PaymentMethod.CASH:
      return { ...NO_SETTLEMENT, cash: amount };
    case PaymentMethod.CHECK:
    case PaymentMethod.BANK_TRANSFER:
      return { ...NO_SETTLEMENT, transfer: amount };
    case PaymentMethod.CREDIT_CARD:
    case PaymentMethod.DEBIT_CARD:
      return { ...NO_SETTLEMENT, card: amount };
    case PaymentMethod.CREDIT:
      return { ...NO_SETTLEMENT, credit: amount };
    case PaymentMethod.GIFT_CARD:
      return { ...NO_SETTLEMENT, giftCard: amount };
    case PaymentMethod.SWAP:
      return { ...NO_SETTLEMENT, swap: amount };
    default:
      return { ...NO_SETTLEMENT, other: amount };
  }
}

/** A supplier comprobante, as a return reads it: the same facts, without the module's own names. */
function purchaseRecord(document: PurchaseFiscalDocument): ReturnPurchaseRecord {
  return {
    kind: document.kind,
    reference: document.reference,
    supplierName: document.supplierName,
    supplierTaxId: document.supplierTaxId,
    supplierCountry: document.supplierCountry,
    fiscalNumber: document.fiscalNumber,
    modifiedFiscalNumber: document.modifiedFiscalNumber,
    date: document.date,
    paidOn: document.paidOn,
    fiscalAttributes: document.fiscalAttributes,
    paymentFiscalCode: document.paymentFiscalCode,
    servicesAmount: document.servicesAmount,
    goodsAmount: document.goodsAmount,
    taxAmount: document.taxAmount,
    taxWithheld: document.taxWithheld,
    taxProportional: document.taxProportional,
    taxToCost: document.taxToCost,
    incomeTaxWithheld: document.incomeTaxWithheld,
    exciseAmount: document.exciseAmount,
    otherTaxes: document.otherTaxes,
    serviceCharge: document.serviceCharge,
    total: document.total,
  };
}

/**
 * The language the company keeps its books in, as its market declares it.
 *
 * Null for a country no package declares: the neutral market has no books language, and an account
 * name then falls back the same way any other missing translation does.
 */
function booksLanguageOf(countryCode: string | null | undefined): string | null {
  return marketFor(countryCode).profile?.booksLanguage ?? null;
}

/**
 * The account's name in the books' own language.
 *
 * `name` is a translated map in this product and a filing wants one string: the market's books
 * language first, then Spanish, then whatever translation exists, then the code itself.
 */
function accountName(account: Account, language: string | null): string {
  const name = account.name as unknown;
  if (typeof name === 'string') return name;
  const translations = (name ?? {}) as Record<string, string>;
  const preferred = (language ?? '').slice(0, 2).toLowerCase();
  return translations[preferred] ?? translations['es'] ?? Object.values(translations)[0] ?? account.code;
}

/**
 * `DEBIT` when the account's increases are debits.
 *
 * The declared nature where the tenant stated one, and the account's type behind it — an asset or
 * an expense is a debit account, everything else a credit one.
 */
function natureOf(account: Account): 'DEBIT' | 'CREDIT' {
  if (account.nature === AccountNature.DEBIT) return 'DEBIT';
  if (account.nature === AccountNature.CREDIT) return 'CREDIT';
  return account.type === AccountType.ASSET || account.type === AccountType.EXPENSE ? 'DEBIT' : 'CREDIT';
}

/**
 * First and last day of the month, `YYYY-MM-DD`, computed in UTC.
 *
 * `new Date(year, month - 1, 1)` is local time and `toISOString()` then converts to UTC, so on a
 * server east of Greenwich the first day of the month became the last day of the previous one and
 * the period silently shifted.
 */
export function monthPeriod(year: number, month: number): ReturnPeriod {
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { year, month, from, to };
}

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function round(value: number | string | null | undefined): number {
  return roundAmount(Number(value ?? 0));
}
