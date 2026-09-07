import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Invoice, InvoiceType } from '../entities/invoice.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { Journal } from '../../journal-entries/entities/journal.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { AccountRole } from '../../chart-of-accounts/enums/account-enums';
import { ModuleSlug } from '../../accounting/entities/accounting-period.entity';
import { JournalEntriesService } from '../../journal-entries/journal-entries.service';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../../journal-entries/dto/create-journal-entry.dto';
import {
  allocate,
  roundToCurrency,
  sumInCurrency,
  toMinorUnits,
} from '../../common/money';
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

    // Withholding is an ASSET, not a receivable from the customer.
    //
    // These two used to fall back to Accounts Receivable when the withholding account was not
    // configured. The entry balanced, so nothing complained — and AR was then overstated by an
    // amount the customer will never pay, because they already remitted it to the authority on our
    // behalf. The aging showed it as perpetually overdue debt, and the credit recoverable against
    // the IT-1 / IR-17 (or the DIOT, the exógena, the PLE) was identifiable in no account at all.
    // Collections already refuses to post without this account; issuance now does the same, and
    // `invoicingGaps` asks for it up front so the refusal never arrives mid-sale.
    const withholding = invoice.taxWithheld + invoice.incomeTaxWithheld;
    if (roundToCurrency(withholding, currency) > 0) {
      if (!settings.defaultTaxWithheldReceivableId) {
        throw new BadRequestError('INVOICES.CUENTA_RETENCIONES_RECIBIDAS_NO_CONFIGURADA');
      }
      push(
        debits,
        settings.defaultTaxWithheldReceivableId,
        invoice.taxWithheld,
        'Impuesto retenido por el cliente',
      );
      push(
        debits,
        settings.defaultTaxWithheldReceivableId,
        invoice.incomeTaxWithheld,
        'Retención de renta',
      );
    }

    // A commercial discount now reduces the taxable base, so `goodsTotal` and `servicesTotal` are
    // already net of it and revenue is credited net. The contra-revenue line records the discount
    // for the reader of the income statement; without it, `subtotal` and the revenue accounts
    // disagree about what was billed.
    push(
      debits,
      settings.defaultSalesDiscountsId ?? settings.defaultSalesRevenueId,
      invoice.discountTotal,
      'Descuento comercial',
    );
    //
    // Revenue is credited GROSS and the discount debited to its contra account, which is how an
    // income statement shows gross sales and the discounts granted on them as separate lines. The
    // discount is split between goods and services in proportion to their net bases, by largest
    // remainder, so the two credits plus the contra debit always add back to `subtotal` exactly.
    const [goodsDiscount, servicesDiscount] = allocate(
      invoice.discountTotal,
      [invoice.goodsTotal, invoice.servicesTotal],
      currency,
    );
    push(
      credits,
      settings.defaultSalesRevenueId,
      roundToCurrency(invoice.goodsTotal + goodsDiscount, currency),
      'Ingresos por ventas',
    );
    push(
      credits,
      settings.defaultServiceRevenueId ?? settings.defaultSalesRevenueId,
      roundToCurrency(invoice.servicesTotal + servicesDiscount, currency),
      'Ingresos por servicios',
    );
    push(credits, settings.defaultSalesTaxId, invoice.tax, 'Impuesto sobre las ventas');

    // Excise (ISC / IEPS / ICE). It is inside `total`, so leaving it uncredited put the entry out
    // of balance by exactly the excise — which is why an invoice subject to one could not be
    // issued at all, and reported the failure as an arithmetic disagreement.
    if (roundToCurrency(invoice.excise, currency) > 0) {
      const exciseAccountId = await this.resolveAccount(
        manager,
        invoice.organizationId,
        AccountRole.EXCISE_TAX_PAYABLE,
        settings.defaultExciseTaxPayableId,
      );
      if (!exciseAccountId) {
        throw new BadRequestError('INVOICES.CUENTA_IMPUESTO_SELECTIVO_NO_CONFIGURADA');
      }
      push(credits, exciseAccountId, invoice.excise, 'Impuesto selectivo al consumo');
    }

    if (roundToCurrency(invoice.serviceCharge, currency) > 0) {
      // Never revenue: it is collected for the staff and owed to them.
      if (!settings.defaultServiceChargePayableId) {
        throw new BadRequestError('INVOICES.CUENTA_PROPINA_LEGAL_NO_CONFIGURADA');
      }
      push(
        credits,
        settings.defaultServiceChargePayableId,
        invoice.serviceCharge,
        'Propina legal por pagar',
      );
    }

    if (debits.length === 0 && credits.length === 0) return null;

    // A last check in the document's own currency, exact to the minor unit.
    //
    // It used to allow half a minor unit of slack and report the failure as "the entry does not
    // balance", which was almost never the real cause: `push` drops a line whose account is not
    // configured, so a missing account presented itself as an arithmetic error. Every account this
    // entry needs is now demanded by name above, so a difference here really is an arithmetic
    // disagreement with the tax engine — and `JournalEntriesService` would reject it anyway.
    const debitSum = sumInCurrency(debits.map((line) => line.amount), currency);
    const creditSum = sumInCurrency(credits.map((line) => line.amount), currency);
    if (toMinorUnits(debitSum, currency) !== toMinorUnits(creditSum, currency)) {
      throw new BadRequestError('INVOICES.ASIENTO_DOCUMENTO_NO_CUADRA', {
        invoiceNumber: invoice.invoiceNumber,
        debit: debitSum,
        credit: creditSum,
      });
    }

    const journal = await this.requireJournal(invoice.organizationId, 'VENTAS', manager);
    const dto: CreateJournalEntryDto = {
      date: new Date(`${invoice.issueDate}T00:00:00.000Z`).toISOString(),
      description: this.describe(invoice),
      journalId: journal.id,
      currencyCode: currency,
      exchangeRate: invoice.exchangeRate,
      lines: this.toLines(debits, credits, isCredit),
    };

    const entry = await this.journalEntries.createWithManager(
      manager,
      dto,
      invoice.organizationId,
      {
        actorUserId: null,
        module: ModuleSlug.AR,
        systemReason: 'invoice-issued',
        idempotencyKey: `invoice:${invoice.id}:revenue`,
      },
    );
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
      lines: this.toLines(debits, credits, isCredit),
    };

    const entry = await this.journalEntries.createWithManager(
      manager,
      dto,
      invoice.organizationId,
      {
        actorUserId: null,
        module: ModuleSlug.AR,
        systemReason: 'invoice-cost-of-sale',
        idempotencyKey: `invoice:${invoice.id}:cost`,
      },
    );
    return entry.id;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Build the journal lines. `reverse` swaps debit and credit wholesale, which is what turns the
   * sale entry into the credit-note entry without duplicating the account mapping.
   *
   * ## No valuations
   *
   * The amounts here are in the **document's** currency, and `JournalEntriesService` converts them
   * to the ledger's and derives the primary valuation from the result. This method used to also
   * hand it a valuation it had converted itself, and the engine multiplied that by the rate a
   * second time: every foreign-currency sales invoice reached the general ledger at `amount ×
   * rate²`. Both sides scaled equally, so the entry balanced and no report could see it — a
   * DOP-based tenant invoicing USD 1,000 at 60 booked 3,600,000 pesos of revenue instead of 60,000.
   *
   * A valuation belongs here only for a ledger *other* than the primary one, expressed in that
   * ledger's own currency. A sales invoice has nothing of the kind to say.
   */
  private toLines(
    debits: PostingLine[],
    credits: PostingLine[],
    reverse: boolean,
  ): CreateJournalEntryLineDto[] {
    const build = (line: PostingLine, isDebit: boolean): CreateJournalEntryLineDto => ({
      accountId: line.accountId,
      debit: isDebit ? line.amount : 0,
      credit: isDebit ? 0 : line.amount,
      description: line.description,
    });

    return [
      ...debits.map((line) => build(line, !reverse)),
      ...credits.map((line) => build(line, reverse)),
    ];
  }

  /** An account by its operational role, falling back to the legacy settings column. */
  private async resolveAccount(
    manager: EntityManager,
    organizationId: string,
    role: AccountRole,
    fallbackId: string | null | undefined,
  ): Promise<string | null> {
    const account = await manager.getRepository(Account).findOne({
      where: { organizationId, systemRole: role },
    });
    return account?.id ?? fallbackId ?? null;
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
      // A catalogue key, not a Spanish sentence: this reaches an accountant who may be reading the
      // product in English or Portuguese, and every other error in this module is already localized.
      throw new BadRequestError('INVOICES.CONFIGURACION_CONTABLE_INCOMPLETA');
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

/**
 * Append a line, skipping zero amounts.
 *
 * It used to skip an unmapped account too, which turned "this tenant has no service-charge account"
 * into "the entry does not balance" — a message pointing at arithmetic when the cause was
 * configuration. Every account this entry needs is now demanded by name at the point it is needed,
 * so an id arriving here null is a programming error and says so.
 */
function push(
  target: PostingLine[],
  accountId: string | null | undefined,
  amount: number,
  description: string,
): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (!accountId) {
    throw new BadRequestError('INVOICES.CUENTA_CONTABLE_NO_CONFIGURADA', { description });
  }
  target.push({ accountId, amount, description });
}

