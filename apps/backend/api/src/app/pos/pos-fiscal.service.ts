import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { CustomerPaymentsService } from '../customers/customer-payments.service';
import { CreateCustomerPaymentDto } from '../customers/dto/create-customer-payment.dto';
import { PaymentMethod as ReceiptMethod } from '../customers/entities/customer-payment.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { Invoice, InvoiceStatus, ModificationCode, PaymentMethod } from '../invoices/entities/invoice.entity';
import { defaultTreasuryAccount, isActiveTreasuryAccount } from '../treasury/contracts/treasury-accounts.contract';
import { organizationFiscalIdentity } from '../organizations/contracts/fiscal-identity.contract';
import { EcfSubmission } from '../einvoicing/entities/ecf-submission.entity';
import { validateTaxId } from '../localization/contracts/tax-id.contract';
import { roundAmount, sumAmounts } from '../common/money';
import { BadRequestError, ConflictError } from '../i18n/localized.exception';
import { AuthenticatedUser } from '../security/principal';
import { PosPayment, PosSale } from './entities/pos-sale.entity';
import { PosFiscalMode, PosSettings } from './entities/pos-settings.entity';

/** The largest difference, in the currency's units, still treated as the same amount. */
const AMOUNT_TOLERANCE = 0.005;

/** Markets where a sale without a fiscal document is not a sale the law recognises. */
const FISCAL_DOCUMENT_REQUIRED = new Set(['DO']);

/** What the ticket prints about the fiscal document, once it is signed. */
export interface PosFiscalStatus {
  saleId: string;
  /** False where the company does not issue a document per till sale. */
  fiscal: boolean;
  invoiceId: string | null;
  invoiceNumber: string | null;
  fiscalNumber: string | null;
  fiscalDocumentType: string | null;
  /** Six characters from the signature; null until the document is signed. */
  securityCode: string | null;
  /** The DGII's timbre URL the ticket's QR encodes; null until signed. */
  qrUrl: string | null;
  /** The transmission's state — PENDING, SIGNED, SENT, ACCEPTED, CONTINGENCY… */
  status: string | null;
  /** When the document was signed, for the ticket's «Fecha de firma». */
  signedAt: string | null;
  creditNoteId: string | null;
  creditNoteFiscalNumber: string | null;
  customer: { name: string | null; taxId: string | null };
}

/** The buyer, as the cashier identified them. */
export interface PosBuyer {
  taxId?: string | null;
  name?: string | null;
}

/**
 * The fiscal side of a till sale.
 *
 * Kept apart from {@link PosService} because it is a different concern with different
 * collaborators — invoicing, receivables, treasury, e-CF — and so the till's arithmetic can still
 * be read on its own. Every method runs inside the sale's transaction: the sale, its document, its
 * ledger entries and its receipts commit together or not at all.
 */
@Injectable()
export class PosFiscalService {
  private readonly logger = new Logger(PosFiscalService.name);

  constructor(
    @InjectRepository(PosSettings) private readonly settingsRepo: Repository<PosSettings>,
    private readonly invoices: InvoicesService,
    private readonly receipts: CustomerPaymentsService,
  ) {}

  // ── Settings ───────────────────────────────────────────────────────────────

  async settings(organizationId: string, manager?: EntityManager): Promise<PosSettings> {
    const repo = manager ? manager.getRepository(PosSettings) : this.settingsRepo;
    return (
      (await repo.findOne({ where: { organizationId } })) ??
      repo.create({
        organizationId,
        fiscalMode: PosFiscalMode.AUTO,
        cashBankAccountId: null,
        cardBankAccountId: null,
        transferBankAccountId: null,
      })
    );
  }

  async updateSettings(
    organizationId: string,
    patch: Partial<Pick<PosSettings, 'fiscalMode' | 'cashBankAccountId' | 'cardBankAccountId' | 'transferBankAccountId'>>,
    manager: EntityManager,
  ): Promise<PosSettings> {
    const current = await this.settings(organizationId, manager);
    const country = await this.countryOf(organizationId, manager);
    if (patch.fiscalMode === PosFiscalMode.OFF && country && FISCAL_DOCUMENT_REQUIRED.has(country)) {
      throw new BadRequestError('pos.fiscal_mode_required_in_market', { country });
    }
    for (const key of ['cashBankAccountId', 'cardBankAccountId', 'transferBankAccountId'] as const) {
      const id = patch[key];
      if (id === undefined || id === null) continue;
      if (!(await isActiveTreasuryAccount(manager, organizationId, id))) {
        throw new BadRequestError('pos.settings_bank_account_unknown');
      }
    }
    Object.assign(current, patch);
    return manager.getRepository(PosSettings).save(current);
  }

  /** Whether this company's till sales are fiscal documents. */
  async issuesFiscalDocuments(organizationId: string, manager: EntityManager): Promise<boolean> {
    const settings = await this.settings(organizationId, manager);
    if (settings.fiscalMode === PosFiscalMode.REQUIRED) return true;
    const country = await this.countryOf(organizationId, manager);
    // Never off where the law requires it, whatever the row says.
    if (country && FISCAL_DOCUMENT_REQUIRED.has(country)) return true;
    return false;
  }

  // ── Issuing ────────────────────────────────────────────────────────────────

  /**
   * Issue the sale's fiscal document and settle it with the tenders, inside the sale's transaction.
   *
   * Returns the issued invoice; the caller hands it to `InvoicesService.dispatchIssued` once the
   * transaction commits, which transmits it to the DGII without holding the counter.
   */
  async issue(
    manager: EntityManager,
    organizationId: string,
    cashier: AuthenticatedUser,
    sale: PosSale,
    buyer: PosBuyer,
    cashKept: number,
  ): Promise<Invoice> {
    const country = await this.countryOf(organizationId, manager);
    const customer = await this.resolveCustomer(manager, organizationId, buyer, country);
    const taxId = customer.isFinalConsumer ? null : customer.taxId ?? null;

    const invoice = await this.invoices.issueForPointOfSale(
      {
        customerId: customer.id,
        branchId: sale.branchId,
        lines: sale.items.map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity),
          unitPrice: Number(line.price),
        })),
        paymentMethod: PosFiscalService.paymentKind(sale.payments, sale.paymentMethod),
        // A buyer with a valid RNC or cédula is owed a crédito fiscal; the adapter decides that on
        // its own from the customer's tax id, so nothing is forced here.
        fiscalDocumentType: null,
        notes: `POS ${sale.terminalId}`,
        capturedAt: sale.capturedAt,
      },
      organizationId,
      manager,
    );

    // The ticket the customer was shown and the document the DGII receives must state one total.
    if (Math.abs(Number(invoice.total) - Number(sale.total)) > AMOUNT_TOLERANCE) {
      throw new ConflictError('pos.fiscal_total_mismatch', {
        ticket: Number(sale.total),
        document: Number(invoice.total),
      });
    }

    sale.invoiceId = invoice.id;
    sale.fiscalNumber = invoice.fiscalNumber ?? null;
    sale.fiscalDocumentType = invoice.fiscalDocumentType ?? null;
    sale.customerId = customer.id;
    sale.customerTaxId = taxId;
    if (!sale.customerName && !customer.isFinalConsumer) sale.customerName = customer.companyName;

    sale.receiptIds = await this.settle(manager, organizationId, cashier, sale, invoice, customer.id, cashKept);
    return invoice;
  }

  /**
   * Cancel the sale's fiscal document: void its receipts (the money goes back out of the drawer)
   * and issue a full credit note (E34) against it. Stock is returned by the caller, against the
   * till's sale, so the note does not restock.
   */
  async cancel(
    manager: EntityManager,
    organizationId: string,
    actor: AuthenticatedUser,
    sale: PosSale,
    reason: string,
  ): Promise<Invoice | null> {
    if (!sale.invoiceId) return null;
    for (const receiptId of sale.receiptIds ?? []) {
      await this.receipts.voidWithin(manager, receiptId, { reason }, organizationId, actor.id);
    }
    const note = await this.invoices.createCreditNoteWithin(
      {
        invoiceId: sale.invoiceId,
        reason,
        // «Anula el NCF modificado»: the whole sale is reversed.
        modificationCode: ModificationCode.ANNULMENT,
        restockGoods: false,
      } as Parameters<InvoicesService['createCreditNoteWithin']>[0],
      organizationId,
      manager,
    );
    sale.creditNoteId = note.id;
    return note;
  }

  /** What the ticket prints about the sale's document, as the e-CF pipeline has it now. */
  async status(manager: EntityManager, organizationId: string, sale: PosSale): Promise<PosFiscalStatus> {
    const base: PosFiscalStatus = {
      saleId: sale.id,
      fiscal: Boolean(sale.invoiceId),
      invoiceId: sale.invoiceId,
      invoiceNumber: null,
      fiscalNumber: sale.fiscalNumber,
      fiscalDocumentType: sale.fiscalDocumentType,
      securityCode: null,
      qrUrl: null,
      status: null,
      signedAt: null,
      creditNoteId: sale.creditNoteId,
      creditNoteFiscalNumber: null,
      customer: { name: sale.customerName, taxId: sale.customerTaxId },
    };
    if (!sale.invoiceId) return base;
    const invoice = await manager.findOne(Invoice, {
      where: { id: sale.invoiceId, organizationId },
      select: ['id', 'invoiceNumber', 'fiscalNumber', 'fiscalDocumentType'],
    });
    base.invoiceNumber = invoice?.invoiceNumber ?? null;
    const submission = await manager.findOne(EcfSubmission, {
      where: { invoiceId: sale.invoiceId, organizationId },
    });
    if (submission) {
      base.securityCode = submission.securityCode ?? null;
      base.qrUrl = submission.qrUrl ?? null;
      base.status = submission.status;
      base.signedAt = submission.securityCode ? (submission.updatedAt?.toISOString() ?? null) : null;
    }
    if (sale.creditNoteId) {
      const note = await manager.findOne(Invoice, {
        where: { id: sale.creditNoteId, organizationId },
        select: ['id', 'fiscalNumber'],
      });
      base.creditNoteFiscalNumber = note?.fiscalNumber ?? null;
    }
    return base;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * The customer the document is issued to.
   *
   * No tax id: the company's «Consumidor final». A tax id: the customer that holds it, created on
   * the spot when the company has never sold to them — an E31 names its buyer, and the 607 lists it.
   * A Dominican tax id must pass its own check digit; a number nobody holds is refused at the
   * counter rather than producing a crédito fiscal the DGII will reject.
   */
  private async resolveCustomer(
    manager: EntityManager,
    organizationId: string,
    buyer: PosBuyer,
    country: string | null,
  ): Promise<Customer> {
    const digits = (buyer.taxId ?? '').replace(/\D/g, '');
    if (!digits) {
      const finalConsumer = await manager.findOne(Customer, {
        where: { organizationId, isFinalConsumer: true },
      });
      if (!finalConsumer) throw new BadRequestError('pos.final_consumer_missing');
      return finalConsumer;
    }
    if (country === 'DO' && (![9, 11].includes(digits.length) || !validateTaxId('DO', digits))) {
      throw new BadRequestError('pos.buyer_tax_id_invalid', { taxId: digits });
    }
    const existing = await manager.findOne(Customer, { where: { organizationId, taxId: digits } });
    if (existing) return existing;

    const name = buyer.name?.trim();
    if (!name) throw new BadRequestError('pos.buyer_name_required');
    return manager.save(
      manager.create(Customer, {
        organizationId,
        companyName: name.slice(0, 255),
        taxId: digits,
        identityDocumentTypeCode: country === 'DO' ? (digits.length === 9 ? 'RNC' : 'CEDULA') : null,
        // The type and its country go together (CK_customers_identity_document_pair).
        identityDocumentCountry: country === 'DO' ? 'DO' : null,
        country,
      } as Partial<Customer>),
    );
  }

  /**
   * One receipt per account the takings landed in: the drawer's cash net of change, the card
   * acquirer's account, the bank for transfers. A tender whose account is not configured is left
   * owing on the invoice (a receivable from the acquirer) rather than invented into an account.
   */
  private async settle(
    manager: EntityManager,
    organizationId: string,
    cashier: AuthenticatedUser,
    sale: PosSale,
    invoice: Invoice,
    customerId: string,
    cashKept: number,
  ): Promise<string[]> {
    const settings = await this.settings(organizationId, manager);
    const tenders = PosFiscalService.tenderTotals(sale.payments ?? [], cashKept, Number(sale.total));

    const buckets: Array<{ amount: number; accountId: string | null; method: ReceiptMethod }> = [
      {
        amount: tenders.cash,
        accountId: settings.cashBankAccountId ?? (await this.defaultAccount(manager, organizationId, 'CASH')),
        method: ReceiptMethod.CASH,
      },
      {
        amount: tenders.card,
        accountId: settings.cardBankAccountId ?? (await this.defaultAccount(manager, organizationId, 'CHECKING')),
        method: ReceiptMethod.CARD,
      },
      {
        amount: tenders.transfer,
        accountId: settings.transferBankAccountId ?? (await this.defaultAccount(manager, organizationId, 'CHECKING')),
        method: ReceiptMethod.BANK_TRANSFER,
      },
    ];

    let open = roundAmount(Number(invoice.netReceivable ?? invoice.total));
    const receiptIds: string[] = [];
    for (const bucket of buckets) {
      const amount = roundAmount(Math.min(bucket.amount, open));
      if (amount <= 0) continue;
      if (!bucket.accountId) {
        this.logger.warn(
          { event: 'pos_tender_unsettled', organizationId, saleId: sale.id, method: bucket.method, amount },
          'POS tender left owing on the invoice: no treasury account configured for it',
        );
        continue;
      }
      const dto: CreateCustomerPaymentDto = {
        customerId,
        branchId: sale.branchId ?? undefined,
        paymentDate: invoice.issueDate as unknown as string,
        bankAccountId: bucket.accountId,
        amountReceived: amount,
        currencyCode: invoice.currencyCode,
        paymentMethod: bucket.method,
        reference: `POS ${sale.terminalId} ${invoice.fiscalNumber ?? invoice.invoiceNumber}`.slice(0, 100),
        lines: [{ invoiceId: invoice.id, amount }],
      };
      const receipt = await this.receipts.receiveWithin(manager, dto, organizationId, cashier.id);
      receiptIds.push(receipt.id);
      open = roundAmount(open - amount);
    }
    if (open > AMOUNT_TOLERANCE && invoice.status !== InvoiceStatus.PAID) {
      this.logger.warn(
        { event: 'pos_invoice_left_open', organizationId, saleId: sale.id, open },
        'POS sale invoice left with an open balance',
      );
    }
    return receiptIds;
  }

  private defaultAccount(
    manager: EntityManager,
    organizationId: string,
    kind: 'CASH' | 'CHECKING',
  ): Promise<string | null> {
    return defaultTreasuryAccount(manager, organizationId, kind);
  }

  private async countryOf(organizationId: string, manager: EntityManager): Promise<string | null> {
    return (await organizationFiscalIdentity(manager, organizationId))?.country ?? null;
  }

  /**
   * What each channel holds from the sale, net of change. A sale from an older till that named no
   * tenders is a cash sale for its whole total.
   */
  static tenderTotals(
    payments: PosPayment[],
    cashKept: number,
    total: number,
  ): { cash: number; card: number; transfer: number } {
    if (payments.length === 0) return { cash: roundAmount(total), card: 0, transfer: 0 };
    const sum = (methods: string[]) =>
      sumAmounts(payments.filter((p) => methods.includes(p.method)).map((p) => Number(p.amount)));
    return { cash: roundAmount(cashKept), card: sum(['card']), transfer: sum(['transfer', 'other']) };
  }

  /** The settlement kind the e-CF's «FormaPago» states. */
  static paymentKind(payments: PosPayment[], method: string | null): PaymentMethod {
    const methods = new Set((payments ?? []).map((p) => p.method));
    if (methods.size === 0) {
      if (!method || ['cash', 'efectivo'].includes(method)) return PaymentMethod.CASH;
      if (method === 'card') return PaymentMethod.CREDIT_CARD;
      if (method === 'transfer') return PaymentMethod.BANK_TRANSFER;
      return PaymentMethod.OTHER;
    }
    if (methods.size > 1) return PaymentMethod.OTHER;
    const only = [...methods][0];
    if (only === 'cash') return PaymentMethod.CASH;
    if (only === 'card') return PaymentMethod.CREDIT_CARD;
    if (only === 'transfer') return PaymentMethod.BANK_TRANSFER;
    return PaymentMethod.OTHER;
  }
}
