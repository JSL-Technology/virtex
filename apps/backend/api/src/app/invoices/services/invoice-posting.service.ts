import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Invoice, InvoiceType } from '../entities/invoice.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { Journal } from '../../journal-entries/entities/journal.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { JournalEntriesService } from '../../journal-entries/journal-entries.service';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../../journal-entries/dto/create-journal-entry.dto';
import { roundToCurrency } from '../sales-tax.engine';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * Turns a sales document into a balanced ledger entry.
 *
 * ## What was wrong
 *
 * Issuing an invoice posted nothing at all. `InvoicesService` emitted `invoice.created` and no
 * listener existed anywhere in the repository; it imported `JournalEntriesService` and never
 * injected it; it called `getOrgAccountingConfig()` — which validates that the receivable, revenue
 * and tax accounts are configured — and threw the result away. Meanwhile collecting a payment DID
 * post, crediting Accounts Receivable. So every collection credited a receivable that had never
 * been debited: the ledger went further out of balance with each payment, and the consumption tax
 * charged to customers was never recognised as a liability. For an accounting product that is not a
 * missing feature, it is the product not working.
 *
 * ## The entries
 *
 * A sale posts two entries, because they live in different currencies and have different lives:
 *
 * **Revenue entry** (transaction currency, `VENTAS` journal)
 * ```
 *   Dr  Accounts receivable            net receivable
 *   Dr  Tax withheld by customer       ITBIS retenido
 *   Dr  Income tax withheld            ISR retenido
 *   Dr  Sales discounts (contra)       document discount
 *       Cr  Sales revenue                          goods invoiced
 *       Cr  Service revenue                        services invoiced
 *       Cr  Tax payable                            output tax + excise
 *       Cr  Service charge payable                 propina legal
 * ```
 *
 * **Cost entry** (base currency, `GENERAL` journal), only when goods actually left inventory
 * ```
 *   Dr  Cost of goods sold             cost of what shipped
 *       Cr  Inventory                              same
 * ```
 *
 * A credit note posts the mirror image of both. Amounts are always positive and the direction is
 * carried by which side of the entry they land on — storing negative debits would make every
 * report that sums a column silently wrong.
 */
@Injectable()
export class InvoicePostingService {
  private readonly logger = new Logger(InvoicePostingService.name);

  constructor(private readonly journalEntries: JournalEntriesService) {}

  /**
   * Post the document and stamp the resulting entry ids on it. Returns the invoice unchanged when
   * there is nothing to post (a zero-value document with no cost).
   */
  async post(invoice: Invoice, manager: EntityManager): Promise<Invoice> {
    const settings = await this.requireSettings(invoice.organizationId, manager);
    const ledger = await this.requireDefaultLedger(invoice.organizationId, manager);
    const isCredit = invoice.type === InvoiceType.CREDIT_NOTE;

    const revenueEntry = await this.postRevenue(invoice, settings, ledger, manager, isCredit);
    if (revenueEntry) invoice.journalEntryId = revenueEntry;

    const costEntry = await this.postCost(invoice, settings, ledger, manager, isCredit);
    if (costEntry) invoice.costJournalEntryId = costEntry;

    return invoice;
  }

  // ── Revenue / receivable ───────────────────────────────────────────────────

  private async postRevenue(
    invoice: Invoice,
    settings: OrganizationSettings,
    ledger: Ledger,
    manager: EntityManager,
    isCredit: boolean,
  ): Promise<string | null> {
    const currency = invoice.currencyCode;
    const debits: PostingLine[] = [];
    const credits: PostingLine[] = [];

    push(debits, settings.defaultAccountsReceivableId, invoice.netReceivable, 'Cuenta por cobrar');
    push(
      debits,
      settings.defaultTaxWithheldReceivableId ?? settings.defaultAccountsReceivableId,
      invoice.taxWithheld,
      'Impuesto retenido por el cliente',
    );
    push(
      debits,
      settings.defaultTaxWithheldReceivableId ?? settings.defaultAccountsReceivableId,
      invoice.incomeTaxWithheld,
      'Retención de renta',
    );
    push(
      debits,
      settings.defaultSalesDiscountsId ?? settings.defaultSalesRevenueId,
      invoice.discountTotal,
      'Descuento comercial',
    );

    push(credits, settings.defaultSalesRevenueId, invoice.goodsTotal, 'Ingresos por ventas');
    push(
      credits,
      settings.defaultServiceRevenueId ?? settings.defaultSalesRevenueId,
      invoice.servicesTotal,
      'Ingresos por servicios',
    );
    push(credits, settings.defaultSalesTaxId, invoice.tax, 'Impuesto sobre las ventas');
    push(
      credits,
      settings.defaultServiceChargePayableId,
      invoice.serviceCharge,
      'Propina legal por pagar',
    );

    if (debits.length === 0 && credits.length === 0) return null;

    // The document is the source of truth; a mismatch here means the totals were computed by
    // something other than the tax engine, and posting an unbalanced entry is never the answer.
    const debitSum = roundToCurrency(debits.reduce((s, l) => s + l.amount, 0), currency);
    const creditSum = roundToCurrency(credits.reduce((s, l) => s + l.amount, 0), currency);
    if (Math.abs(debitSum - creditSum) > 0.005) {
      throw new BadRequestException(
        `El asiento de la factura ${invoice.invoiceNumber} no cuadra: débitos ${debitSum.toFixed(2)} ` +
          `frente a créditos ${creditSum.toFixed(2)}.`,
      );
    }

    const journal = await this.requireJournal(invoice.organizationId, 'VENTAS', manager);
    const dto: CreateJournalEntryDto = {
      date: new Date(`${invoice.issueDate}T00:00:00.000Z`).toISOString(),
      description: this.describe(invoice),
      journalId: journal.id,
      currencyCode: currency,
      exchangeRate: invoice.exchangeRate,
      lines: this.toLines(debits, credits, ledger.id, invoice.exchangeRate, isCredit),
    };

    const entry = await this.journalEntries.createWithManager(manager, dto, invoice.organizationId);
    this.logger.log(
      `Documento ${invoice.invoiceNumber} contabilizado en el asiento ${entry.id.substring(0, 8)}.`,
    );
    return entry.id;
  }

  // ── Cost of sale ───────────────────────────────────────────────────────────

  private async postCost(
    invoice: Invoice,
    settings: OrganizationSettings,
    ledger: Ledger,
    manager: EntityManager,
    isCredit: boolean,
  ): Promise<string | null> {
    const cost = roundToCurrency(invoice.costOfSale, settings.baseCurrency);
    if (cost <= 0) return null;
    if (!settings.defaultCostOfGoodsSoldId || !settings.defaultInventoryId) {
      // Nothing here is worth aborting a sale over: the revenue side is already correct, and a
      // tenant whose chart has no inventory accounts is not tracking stock in the ledger anyway.
      this.logger.warn(
        `La organización ${invoice.organizationId} no tiene cuentas de inventario/costo configuradas; ` +
          `no se contabilizó el costo de la venta ${invoice.invoiceNumber}.`,
      );
      return null;
    }

    const journal = await this.requireJournal(invoice.organizationId, 'GENERAL', manager);
    const debits: PostingLine[] = [
      { accountId: settings.defaultCostOfGoodsSoldId, amount: cost, description: 'Costo de ventas' },
    ];
    const credits: PostingLine[] = [
      { accountId: settings.defaultInventoryId, amount: cost, description: 'Salida de inventario' },
    ];

    const dto: CreateJournalEntryDto = {
      date: new Date(`${invoice.issueDate}T00:00:00.000Z`).toISOString(),
      description: `Costo de ${this.describe(invoice)}`,
      journalId: journal.id,
      currencyCode: settings.baseCurrency,
      exchangeRate: 1,
      lines: this.toLines(debits, credits, ledger.id, 1, isCredit),
    };

    const entry = await this.journalEntries.createWithManager(manager, dto, invoice.organizationId);
    return entry.id;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Build the journal lines. `reverse` swaps debit and credit wholesale, which is what turns the
   * sale entry into the credit-note entry without duplicating the account mapping.
   */
  private toLines(
    debits: PostingLine[],
    credits: PostingLine[],
    ledgerId: string,
    exchangeRate: number,
    reverse: boolean,
  ): CreateJournalEntryLineDto[] {
    const build = (line: PostingLine, isDebit: boolean): CreateJournalEntryLineDto => {
      const debit = isDebit ? line.amount : 0;
      const credit = isDebit ? 0 : line.amount;
      return {
        accountId: line.accountId,
        debit,
        credit,
        description: line.description,
        // Valuations are expressed in the ledger's own (base) currency.
        valuations: [
          {
            ledgerId,
            debit: round2(debit * exchangeRate),
            credit: round2(credit * exchangeRate),
          },
        ],
      };
    };

    return [
      ...debits.map((line) => build(line, !reverse)),
      ...credits.map((line) => build(line, reverse)),
    ];
  }

  private describe(invoice: Invoice): string {
    const kind =
      invoice.type === InvoiceType.CREDIT_NOTE
        ? 'Nota de crédito'
        : invoice.type === InvoiceType.DEBIT_NOTE
          ? 'Nota de débito'
          : 'Factura';
    const fiscal = invoice.ncfNumber ? ` (${invoice.ncfNumber})` : '';
    return `${kind} ${invoice.invoiceNumber}${fiscal} — ${invoice.customerName}`;
  }

  private async requireSettings(
    organizationId: string,
    manager: EntityManager,
  ): Promise<OrganizationSettings> {
    const settings = await manager
      .getRepository(OrganizationSettings)
      .findOne({ where: { organizationId } });

    if (
      !settings ||
      !settings.defaultAccountsReceivableId ||
      !settings.defaultSalesRevenueId ||
      !settings.defaultSalesTaxId
    ) {
      throw new BadRequestException(
        'La configuración contable de la organización está incompleta: se requieren las cuentas de ' +
          'Cuentas por Cobrar, Ingresos por Ventas e Impuesto sobre Ventas por Pagar. ' +
          'Revísalas en Ajustes → Contabilidad.',
      );
    }
    return settings;
  }

  private async requireDefaultLedger(
    organizationId: string,
    manager: EntityManager,
  ): Promise<Ledger> {
    const ledger = await manager
      .getRepository(Ledger)
      .findOne({ where: { organizationId, isDefault: true } });
    if (!ledger) {
      throw new BadRequestError('INVOICES.ORGANIZACION_NO_TIENE_LIBRO_CONTABLE_DEFECTO_CREALO');
    }
    return ledger;
  }

  private async requireJournal(
    organizationId: string,
    code: string,
    manager: EntityManager,
  ): Promise<Journal> {
    const journal = await manager.getRepository(Journal).findOne({ where: { organizationId, code } });
    if (!journal) {
      throw new BadRequestError('INVOICES.NO_EXISTE_DIARIO_ESTA_ORGANIZACION_CREALO_AJUSTES', { code });
    }
    return journal;
  }
}

interface PostingLine {
  accountId: string;
  amount: number;
  description: string;
}

/** Append a line, skipping zero amounts and unmapped accounts. */
function push(
  target: PostingLine[],
  accountId: string | null | undefined,
  amount: number,
  description: string,
): void {
  const value = round2(amount);
  if (!accountId || value <= 0) return;
  target.push({ accountId, amount: value, description });
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
