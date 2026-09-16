import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, EntityManager } from 'typeorm';
import {
  CustomerPayment,
  CustomerPaymentStatus,
} from './entities/customer-payment.entity';
import { CustomerPaymentLine } from './entities/customer-payment-line.entity';
import {
  CreateCustomerPaymentDto,
  VoidCustomerPaymentDto,
} from './dto/create-customer-payment.dto';
import { Customer } from './entities/customer.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { AccountingPostingPort } from '../journal-entries/accounting-posting.port';
import {
  JournalEntryNumberingService,
  SEQUENCE_SCOPE,
} from '../journal-entries/journal-entry-numbering.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { BankAccount } from '../treasury/entities/bank-account.entity';
import { AccountRole } from '../chart-of-accounts/enums/account-enums';
import { ModuleSlug } from '../journal-entries/accounting-posting.port';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { convert, roundAmount, sumAmounts, toCents } from '../common/money';
import {
  AccountBalancesService,
  toIsoDate,
} from '../chart-of-accounts/account-balances.service';
import {
  AgingBucket,
  AgingReport,
  AgingRow,
} from '../accounts-payable/accounts-payable.service';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';

const AGING_BUCKETS: { label: string; from: number; to: number | null }[] = [
  { label: '1-30', from: 1, to: 30 },
  { label: '31-60', from: 31, to: 60 },
  { label: '61-90', from: 61, to: 90 },
  { label: '90+', from: 91, to: null },
];

/**
 * Collections from customers.
 *
 * ## What existed
 *
 * One method — `create` — reachable through one route, `POST /customer-payments`. There was no way
 * to list receipts, fetch one, or reverse one, and the frontend's receipt list called
 * `GET /customer-payments`, which did not exist; its service was annotated "Placeholder methods"
 * and its interface expected `receiptNumber`, `customerName` and `amount`, none of which the entity
 * had.
 *
 * Beyond the missing surface, the one method that did exist could only record the simplest possible
 * receipt: every currency was treated as the books' currency, so a collection against a
 * foreign-currency invoice booked the wrong amount and never recognised the exchange difference;
 * withholding — which customers across the region apply as a matter of law — had nowhere to go, so
 * a receipt net of withholding under-relieved the receivable and left it permanently short; an
 * advance or an overpayment could not be recorded at all, because the total had to equal the sum
 * applied to existing invoices; and a bounced cheque could not be reversed.
 */
@Injectable()
export class CustomerPaymentsService {
  private readonly logger = new Logger(CustomerPaymentsService.name);

  constructor(
    @InjectRepository(CustomerPayment)
    private readonly paymentRepository: Repository<CustomerPayment>,
    private readonly posting: AccountingPostingPort,
    private readonly numbering: JournalEntryNumberingService,
    private readonly exchangeRates: ExchangeRateResolver,
    private readonly dataSource: DataSource,
    /**
     * The general ledger's own view of what is collectible, so the ageing can be tied to its
     * control account on the page instead of by somebody exporting both and subtracting.
     */
    private readonly balances: AccountBalancesService,
    /** The ledger's narrative, in the language the books are kept in. */
    private readonly narrative: LedgerNarrativeService,
  ) {}

  /**
   * The receivables control account's balance in the general ledger, as a positive amount owed
   * to the tenant.
   *
   * Balances are signed `debit − credit` and a receivable is a debit balance, so unlike payables
   * the ledger's figure already has the sign the ageing states; there is nothing to flip.
   */
  private async receivablesControlBalance(
    organizationId: string,
    settings: OrganizationSettings | null,
    asOfDate: string,
  ): Promise<number> {
    const accountId = await this.resolveAccount(
      this.dataSource.manager,
      organizationId,
      AccountRole.ACCOUNTS_RECEIVABLE,
      settings?.defaultAccountsReceivableId,
    );
    if (!accountId) return 0;

    const ledger = await this.dataSource.manager.findOneBy(Ledger, {
      organizationId,
      isDefault: true,
    });
    if (!ledger) return 0;

    return roundAmount(
      await this.balances.balanceOf(accountId, {
        organizationId,
        ledgerId: ledger.id,
        asOf: asOfDate,
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Recording a collection
  // ───────────────────────────────────────────────────────────────────────────

  async create(
    dto: CreateCustomerPaymentDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<CustomerPayment> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
      if (!settings?.defaultAccountsReceivableId) {
        throw new BadRequestError(
          'customers.default_receivable_account_not_configured_organization',
        );
      }
      const baseCurrency = settings.baseCurrency ?? 'USD';
      const currencyCode = (dto.currencyCode ?? baseCurrency).toUpperCase();

      const customer = await manager.findOneBy(Customer, {
        id: dto.customerId,
        organizationId,
      });
      if (!customer) throw new NotFoundError('customers.customer_not_found');

      // A receipt may be funded by fresh cash, by money the customer already left on account, or by
      // both — but not by nothing.
      const advanceDraw = roundAmount(dto.advanceApplied ?? 0);
      if (toCents(dto.amountReceived) + toCents(advanceDraw) <= 0) {
        throw new BadRequestError('customers.receipt_has_no_funds_enter_amount');
      }

      const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!ledger) {
        throw new BadRequestError(
          'customers.no_default_ledger_has_configured_organization',
        );
      }

      const collectionJournal = await manager.findOneBy(Journal, {
        organizationId,
        code: 'COBROS',
      });
      if (!collectionJournal) {
        throw new BadRequestError('customers.collections_journal_cobros_not_found_create');
      }

      // A real bank account, not a chart-of-accounts row. Which account the funds landed in is
      // what lets a bank statement be reconciled against this receipt later; a control account
      // shared by four bank accounts cannot answer that.
      const bankAccount = await manager.findOneBy(BankAccount, {
        id: dto.bankAccountId,
        organizationId,
      });
      if (!bankAccount) throw new BadRequestError('customers.specified_bank_account_does_not_exist');
      if (!bankAccount.isActive) {
        throw new BadRequestError('customers.bank_account_name_inactive_cannot_take', {
          name: bankAccount.name,
        });
      }
      // Either the funds arrive in the account's own currency, or the account keeps the books'
      // currency and the bank converted on the way in — that second case is the one the ledger
      // can still measure, at the day's rate. Anything else (a USD receipt into a EUR account)
      // needs a rate nobody has stated, and guessing one would misstate cash.
      if (
        bankAccount.currencyCode !== currencyCode &&
        bankAccount.currencyCode !== baseCurrency
      ) {
        throw new BadRequestError('customers.receipt_receipt_cannot_land_account_account', {
          receipt: currencyCode,
          account: bankAccount.currencyCode,
        });
      }

      const receiptRate = await this.exchangeRates.rateFor(
        currencyCode,
        baseCurrency,
        dto.paymentDate,
        manager,
      );

      const lines = dto.lines ?? [];
      const invoices = lines.length
        ? await manager.find(Invoice, {
            where: {
              id: In(lines.map((line) => line.invoiceId)),
              organizationId,
              customerId: dto.customerId,
            },
          })
        : [];
      const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

      const payment = await manager.save(
        manager.create(CustomerPayment, {
          organizationId,
          customerId: dto.customerId,
          paymentDate: toIsoDate(dto.paymentDate) as unknown as Date,
          bankAccountId: dto.bankAccountId,
          reference: dto.reference ?? null,
          paymentMethod: dto.paymentMethod,
          currencyCode,
          exchangeRate: receiptRate,
          totalAmount: dto.amountReceived,
          unappliedAmount: 0,
          status: CustomerPaymentStatus.POSTED,
          createdByUserId: actorUserId,
          receiptNumber: await this.nextReceiptNumber(manager, organizationId, dto.paymentDate),
        }),
      );

      let cashInBase = 0;
      let receivableCreditBase = 0;
      let withheldTaxBase = 0;
      let withheldIncomeBase = 0;
      let discountBase = 0;
      let exchangeDifferenceBase = 0;
      let appliedInReceiptCurrency = 0;

      for (const line of lines) {
        const invoice = invoicesById.get(line.invoiceId);
        if (!invoice) {
          throw new BadRequestError('customers.one_more_invoices_invalid_do_not');
        }
        if (
          invoice.status !== InvoiceStatus.PENDING &&
          invoice.status !== InvoiceStatus.PARTIALLY_PAID
        ) {
          throw new BadRequestError('customers.invoice_invoice_number_status_cannot_take', {
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
          });
        }

        const taxWithheld = roundAmount(line.taxWithheld ?? 0);
        const incomeTaxWithheld = roundAmount(line.incomeTaxWithheld ?? 0);
        const discount = roundAmount(line.discount ?? 0);
        // What comes off the invoice is the cash plus everything that settled it without cash.
        const relieved = roundAmount(
          line.amount + taxWithheld + incomeTaxWithheld + discount,
        );

        if (toCents(relieved) > toCents(invoice.balance)) {
          throw new BadRequestError('customers.payment_invoice_invoice_number_amount_exceeds', {
            invoiceNumber: invoice.invoiceNumber,
            amount: relieved,
            balance: invoice.balance,
          });
        }

        // The invoice was booked at its own rate; the receipt arrives at today's. The gap on the
        // amount relieved is a realised gain or loss, and without it the receivable cannot clear.
        const invoiceRate = Number(invoice.exchangeRate) || 1;
        const relievedAtInvoiceRate = convert(relieved, invoiceRate);
        const cashAtReceiptRate = convert(line.amount, receiptRate);
        const taxAtReceiptRate = convert(taxWithheld, receiptRate);
        const incomeAtReceiptRate = convert(incomeTaxWithheld, receiptRate);
        const discountAtReceiptRate = convert(discount, receiptRate);
        const difference = roundAmount(
          relievedAtInvoiceRate -
            (cashAtReceiptRate +
              taxAtReceiptRate +
              incomeAtReceiptRate +
              discountAtReceiptRate),
        );

        cashInBase = roundAmount(cashInBase + cashAtReceiptRate);
        receivableCreditBase = roundAmount(receivableCreditBase + relievedAtInvoiceRate);
        withheldTaxBase = roundAmount(withheldTaxBase + taxAtReceiptRate);
        withheldIncomeBase = roundAmount(withheldIncomeBase + incomeAtReceiptRate);
        discountBase = roundAmount(discountBase + discountAtReceiptRate);
        exchangeDifferenceBase = roundAmount(exchangeDifferenceBase + difference);
        appliedInReceiptCurrency = roundAmount(appliedInReceiptCurrency + line.amount);

        invoice.balance = roundAmount(invoice.balance - relieved);
        invoice.status =
          toCents(invoice.balance) === 0
            ? InvoiceStatus.PAID
            : InvoiceStatus.PARTIALLY_PAID;
        await manager.save(invoice);

        await manager.save(
          manager.create(CustomerPaymentLine, {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: relieved,
            taxWithheld,
            incomeTaxWithheld,
            discount,
            exchangeDifference: difference,
          }),
        );
      }

      // Drawing on an advance only makes sense against the currency it was received in: the money
      // held is a number of pesos or of dollars, and spending it as the other would invent a rate
      // nobody agreed to.
      let advanceDrawBase = 0;
      if (toCents(advanceDraw) > 0) {
        const held = await this.advanceOutstanding(
          manager,
          organizationId,
          dto.customerId,
          currencyCode,
        );
        if (toCents(advanceDraw) > toCents(held.amount)) {
          throw new BadRequestError('customers.customer_only_holds_available_currency_advances', {
            requested: advanceDraw,
            available: held.amount,
            currency: currencyCode,
          });
        }
        // Retired at what the customer actually paid — the weighted average of the receipts still
        // holding money — so the liability leaves the books for the amount it entered them at.
        advanceDrawBase = roundAmount(advanceDraw * (held.averageRate ?? receiptRate));
        // The gap against today's rate is realised here, exactly as it is on an invoice.
        exchangeDifferenceBase = roundAmount(
          exchangeDifferenceBase + (convert(advanceDraw, receiptRate) - advanceDrawBase),
        );
      }

      // Anything received beyond what was applied is held as a customer advance.
      const unapplied = roundAmount(dto.amountReceived + advanceDraw - appliedInReceiptCurrency);
      if (toCents(unapplied) < 0) {
        throw new BadRequestError('customers.amount_applied_invoices_applied_exceeds_amount', {
          received: roundAmount(dto.amountReceived + advanceDraw),
          applied: appliedInReceiptCurrency,
        });
      }
      // Taking money off account only to put it straight back is not a transaction; it would leave
      // the drawn receipt looking spent and the ledger unchanged.
      if (toCents(advanceDraw) > 0 && toCents(unapplied) > 0) {
        throw new BadRequestError('customers.drawn_drawn_from_advance_but_unapplied', {
          drawn: advanceDraw,
          unapplied,
        });
      }
      const unappliedBase = convert(unapplied, receiptRate);
      cashInBase = roundAmount(cashInBase + unappliedBase);
      payment.unappliedAmount = unapplied;
      payment.advanceAppliedAmount = advanceDraw;
      payment.advanceAppliedBaseAmount = advanceDrawBase;

      const entryLines: CreateJournalEntryLineDto[] = [];
      const push = (
        accountId: string,
        debit: number,
        credit: number,
        description: string,
      ) => {
        if (toCents(debit) === 0 && toCents(credit) === 0) return;
        entryLines.push({
          accountId,
          debit,
          credit,
          description,
          valuations: [{ ledgerId: ledger.id, debit, credit }],
        });
      };

      //  El relato del asiento, en el idioma en que se llevan los libros de este inquilino.
      //  Eran literales castellanos, de modo que un inquilino estadounidense abría su mayor y leía
      //  su propia contabilidad en un idioma que nadie en la empresa habla.
      const words = await this.narrative.describeAll(manager, organizationId, {
        bankIn: { key: 'ledger.collection.bank_in' },
        receivable: {
          key: 'ledger.collection.receivable_settled',
          params: { customer: customer.companyName ?? customer.id },
        },
        withheld: { key: 'ledger.collection.withheld_by_customer' },
        discount: { key: 'ledger.collection.early_payment_discount' },
        advanceApplied: { key: 'ledger.collection.advance_applied' },
        advanceHeld: { key: 'ledger.collection.advance_held' },
        forex: { key: 'ledger.collection.exchange_difference' },
      });

      // Only the cash that actually arrived hits the bank. The part funded from an advance moved
      // between two balance-sheet lines and never touched the account.
      const bankDebitBase = roundAmount(cashInBase - convert(advanceDraw, receiptRate));
      push(bankAccount.glAccountId, bankDebitBase, 0, words.bankIn);
      push(settings.defaultAccountsReceivableId, 0, receivableCreditBase, words.receivable);

      if (toCents(withheldTaxBase) !== 0 || toCents(withheldIncomeBase) !== 0) {
        const withholdingReceivableId = await this.resolveAccount(
          manager,
          organizationId,
          AccountRole.WITHHOLDING_RECEIVABLE,
          settings.defaultTaxWithheldReceivableId,
        );
        if (!withholdingReceivableId) {
          throw new BadRequestError('customers.no_withholding_receivable_account_configured_customer');
        }
        // An asset: the customer paid it to the authority on our behalf and we recover it.
        push(
          withholdingReceivableId,
          roundAmount(withheldTaxBase + withheldIncomeBase),
          0,
          words.withheld,
        );
      }

      if (toCents(discountBase) !== 0) {
        const discountAccountId = await this.resolveAccount(
          manager,
          organizationId,
          AccountRole.SALES_DISCOUNTS,
          settings.defaultSalesDiscountsId,
        );
        if (!discountAccountId) {
          throw new BadRequestError('customers.no_discount_account_configured_receipt_grants');
        }
        push(discountAccountId, discountBase, 0, words.discount);
      }

      if (toCents(unappliedBase) !== 0 || toCents(advanceDrawBase) !== 0) {
        const advanceAccountId = await this.resolveAdvanceAccount(
          manager,
          organizationId,
          settings,
        );
        // Held, not earned: money against no document is owed back until it is applied — and when
        // it is applied, the obligation is discharged rather than the receivable credited twice.
        push(
          advanceAccountId,
          advanceDrawBase,
          unappliedBase,
          toCents(advanceDrawBase) > 0 ? words.advanceApplied : words.advanceHeld,
        );
      }

      if (toCents(exchangeDifferenceBase) !== 0) {
        const forexAccountId = await this.resolveAccount(
          manager,
          organizationId,
          AccountRole.FOREX_GAIN_LOSS,
          settings.defaultForexGainLossAccountId,
        );
        if (!forexAccountId) {
          throw new BadRequestError('customers.no_exchange_difference_account_configured_receipt');
        }
        push(
          forexAccountId,
          exchangeDifferenceBase > 0 ? exchangeDifferenceBase : 0,
          exchangeDifferenceBase < 0 ? Math.abs(exchangeDifferenceBase) : 0,
          words.forex,
        );
      }

      const entry = await this.posting.createWithManager(
        manager,
        {
          date: toIsoDate(dto.paymentDate),
          description: await this.narrative.describe(
            manager,
            organizationId,
            'ledger.collection.receipt',
            { number: payment.receiptNumber ?? payment.id.slice(0, 8) },
          ),
          journalId: collectionJournal.id,
          lines: entryLines,
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId, module: ModuleSlug.AR, systemReason: 'customer-collection' },
      );

      payment.journalEntryId = entry.id;
      const saved = await manager.save(payment);

      this.logger.log(
        `Cobro ${saved.receiptNumber} contabilizado en ${entry.entryNumber}.`,
      );
      return saved;
    });
  }

  /**
   * Reverse a receipt: a bounced cheque, a returned transfer, a receipt raised in error.
   *
   * The invoices it settled go back to what they owed, and the ledger entry is reversed rather than
   * deleted, so the correction is legible in the book. There was previously no way to do this at
   * all — a receipt, once created, was permanent.
   */
  async voidPayment(
    id: string,
    dto: VoidCustomerPaymentDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<CustomerPayment> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(CustomerPayment, {
        where: { id, organizationId },
        relations: ['lines'],
      });
      if (!payment) throw new NotFoundError('customers.receipt_not_found');
      if (payment.status === CustomerPaymentStatus.VOID) {
        throw new BadRequestError('customers.receipt_has_already_voided');
      }

      // An advance this receipt created may already have been spent on a later invoice. Reversing
      // it anyway would leave the customer holding a negative balance on account and the liability
      // account short by the amount someone else's receipt already relieved.
      if (toCents(payment.unappliedAmount - payment.advanceAppliedAmount) > 0) {
        const held = await this.advanceOutstanding(
          manager,
          payment.organizationId,
          payment.customerId,
          payment.currencyCode,
        );
        const remaining = roundAmount(
          held.amount - (payment.unappliedAmount - payment.advanceAppliedAmount),
        );
        if (toCents(remaining) < 0) {
          throw new BadRequestError('customers.receipt_receipt_cannot_voided_applied_advance', {
            receipt: payment.receiptNumber ?? payment.id,
            applied: roundAmount(Math.abs(remaining)),
          });
        }
      }

      for (const line of payment.lines) {
        const invoice = await manager.findOneBy(Invoice, {
          id: line.invoiceId,
          organizationId,
        });
        if (!invoice) continue;
        invoice.balance = roundAmount(invoice.balance + line.amount);
        invoice.status =
          toCents(invoice.balance) >= toCents(invoice.netReceivable ?? invoice.balance)
            ? InvoiceStatus.PENDING
            : InvoiceStatus.PARTIALLY_PAID;
        await manager.save(invoice);
      }

      if (payment.journalEntryId) {
        const reversal = await this.posting.createSystemReversal(
          payment.journalEntryId,
          organizationId,
          {
            reversalDate: toIsoDate(dto.reversalDate ?? new Date()),
            reason: `Anulación de cobro: ${dto.reason}`,
          },
          manager,
          { actorUserId, module: ModuleSlug.AR, systemReason: 'customer-collection-void' },
        );
        payment.reversalJournalEntryId = reversal.id;
      }

      payment.status = CustomerPaymentStatus.VOID;
      payment.voidReason = dto.reason;
      payment.voidedAt = new Date();
      const saved = await manager.save(payment);

      this.logger.log(`Cobro ${payment.receiptNumber} anulado: ${dto.reason}`);
      return saved;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  findAll(organizationId: string, customerId?: string): Promise<CustomerPayment[]> {
    return this.paymentRepository.find({
      where: { organizationId, ...(customerId ? { customerId } : {}) },
      relations: ['customer'],
      order: { paymentDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<CustomerPayment> {
    const payment = await this.paymentRepository.findOne({
      where: { id, organizationId },
      relations: ['lines', 'lines.invoice', 'customer'],
    });
    if (!payment) throw new NotFoundError('customers.receipt_not_found');
    return payment;
  }

  /** What customers owe, by customer and by how overdue it is. */
  async aging(
    organizationId: string,
    asOf: Date | string = new Date(),
  ): Promise<AgingReport> {
    const asOfDate = toIsoDate(asOf);
    const settings = await this.dataSource.manager.findOneBy(OrganizationSettings, {
      organizationId,
    });
    const baseCurrency = settings?.baseCurrency ?? 'USD';

    const invoices = await this.dataSource.getRepository(Invoice).find({
      where: {
        organizationId,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID]),
      },
      relations: ['customer'],
    });

    // At the rate AS OF the reporting date. The receivable control account is restated to the
    // closing rate by the period-end revaluation, so ageing at each document's booked rate drifted
    // from it after every close, with nothing to report the gap — and tying a subledger to its
    // control account is the substantiation an auditor asks for first.
    const currencies = [
      ...new Set(
        invoices
          .map((invoice) => (invoice.currencyCode ?? baseCurrency).toUpperCase())
          .filter((code) => code !== baseCurrency),
      ),
    ];
    const closingRates = new Map<string, number>();
    let unconvertedDocuments = 0;
    for (const currency of currencies) {
      try {
        closingRates.set(
          currency,
          await this.exchangeRates.rateFor(currency, baseCurrency, asOfDate),
        );
      } catch {
        this.logger.warn(
          `Sin tasa ${currency}→${baseCurrency} al ${asOfDate}; esos documentos se antigüedad ` +
            'a la tasa de registro.',
        );
      }
    }

    const cutoff = new Date(`${asOfDate}T00:00:00.000Z`).getTime();
    const byCustomer = new Map<string, AgingRow>();

    for (const invoice of invoices) {
      if (toCents(invoice.balance) === 0) continue;
      const dueDate = invoice.dueDate ?? invoice.issueDate;
      const due = new Date(`${toIsoDate(dueDate)}T00:00:00.000Z`).getTime();
      const daysOverdue = Math.floor((cutoff - due) / 86_400_000);

      const currency = (invoice.currencyCode ?? baseCurrency).toUpperCase();
      const closingRate = currency === baseCurrency ? 1 : closingRates.get(currency);
      if (currency !== baseCurrency && closingRate === undefined) unconvertedDocuments += 1;
      const amount = convert(invoice.balance, closingRate ?? (Number(invoice.exchangeRate) || 1));

      const row =
        byCustomer.get(invoice.customerId) ??
        ({
          partyId: invoice.customerId,
          partyName:
            invoice.customer?.companyName ?? invoice.customerName ?? invoice.customerId,
          current: 0,
          buckets: AGING_BUCKETS.map((bucket) => ({ ...bucket, amount: 0 })),
          total: 0,
        } satisfies AgingRow);

      if (daysOverdue <= 0) {
        row.current = roundAmount(row.current + amount);
      } else {
        const bucket =
          row.buckets.find(
            (candidate) =>
              daysOverdue >= candidate.from &&
              (candidate.to === null || daysOverdue <= candidate.to),
          ) ?? row.buckets[row.buckets.length - 1];
        bucket.amount = roundAmount(bucket.amount + amount);
      }
      row.total = roundAmount(row.total + amount);
      byCustomer.set(invoice.customerId, row);
    }

    const rows = [...byCustomer.values()].sort((a, b) => b.total - a.total);
    const total = sumAmounts(rows.map((row) => row.total));
    const controlAccountBalance = await this.receivablesControlBalance(
      organizationId,
      settings,
      asOfDate,
    );

    return {
      asOfDate,
      currencyCode: baseCurrency,
      controlAccountBalance,
      // Signed: positive means the subledger claims more is collectible than the ledger records.
      controlAccountDifference: roundAmount(total - controlAccountBalance),
      unconvertedDocuments,
      rows,
      totals: {
        current: sumAmounts(rows.map((row) => row.current)),
        buckets: AGING_BUCKETS.map((bucket, index) => ({
          ...bucket,
          amount: sumAmounts(rows.map((row) => row.buckets[index].amount)),
        })),
        total: sumAmounts(rows.map((row) => row.total)),
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async resolveAccount(
    manager: EntityManager,
    organizationId: string,
    role: AccountRole,
    fallbackId: string | null | undefined,
  ): Promise<string | null> {
    const account = await manager.findOne(Account, {
      where: { organizationId, systemRole: role },
    });
    return account?.id ?? fallbackId ?? null;
  }

  /**
   * Where a customer advance is held: a current liability of its own.
   *
   * It used to be the receivables control account, used as a contra — an advance sat there as a
   * credit. That is wrong twice over. It drove the control account below zero the moment a customer
   * paid ahead of being invoiced, so the balance sheet reported a *negative asset* where there was
   * a real obligation; and it broke the ageing report's own reconciliation, which compares the
   * subledger against that account and had no way to know part of the balance was not a receivable
   * at all. Money held against no document is owed back, and a liability is where it belongs.
   */
  private async resolveAdvanceAccount(
    manager: EntityManager,
    organizationId: string,
    settings: OrganizationSettings,
  ): Promise<string> {
    const advanceId = await this.resolveAccount(
      manager,
      organizationId,
      AccountRole.CUSTOMER_ADVANCES,
      settings.defaultCustomerAdvancesAccountId,
    );
    if (!advanceId) {
      throw new BadRequestError('customers.customer_advances_account_not_configured_organization');
    }
    return advanceId;
  }

  /**
   * What this customer has paid ahead and not yet spent, in one currency.
   *
   * Returned in both the customer's currency and the books', because an advance is consumed at the
   * weighted-average rate it was received at, not at the rate of the day it is spent. Only POSTED
   * receipts count: voiding the receipt that created an advance takes the advance with it.
   */
  private async advanceOutstanding(
    manager: EntityManager,
    organizationId: string,
    customerId: string,
    currencyCode: string,
  ): Promise<{ amount: number; baseAmount: number; averageRate: number | null }> {
    const [row] = (await manager.query(
      `SELECT
         COALESCE(SUM(p.unapplied_amount - p.advance_applied_amount), 0) AS amount,
         COALESCE(
           SUM(p.unapplied_amount * p.exchange_rate - p.advance_applied_base_amount),
           0
         ) AS base_amount
       FROM customer_payments p
       WHERE p.organization_id = $1
         AND p.customer_id = $2
         AND p.currency_code = $3
         AND p.status = $4`,
      [organizationId, customerId, currencyCode, CustomerPaymentStatus.POSTED],
    )) as { amount: string; base_amount: string }[];

    const amount = roundAmount(Number(row?.amount ?? 0));
    const baseAmount = roundAmount(Number(row?.base_amount ?? 0));
    return {
      amount,
      baseAmount,
      averageRate: toCents(amount) > 0 ? baseAmount / amount : null,
    };
  }

  /**
   * Advances a customer is holding, per currency — what the receipt screen offers to draw on.
   */
  async advances(
    organizationId: string,
    customerId: string,
  ): Promise<{ currencyCode: string; amount: number; baseAmount: number }[]> {
    const rows = (await this.dataSource.manager.query(
      `SELECT p.currency_code AS "currencyCode",
              SUM(p.unapplied_amount - p.advance_applied_amount) AS amount,
              SUM(p.unapplied_amount * p.exchange_rate - p.advance_applied_base_amount) AS "baseAmount"
         FROM customer_payments p
        WHERE p.organization_id = $1
          AND p.customer_id = $2
          AND p.status = $3
        GROUP BY p.currency_code
       HAVING SUM(p.unapplied_amount - p.advance_applied_amount) <> 0
        ORDER BY p.currency_code`,
      [organizationId, customerId, CustomerPaymentStatus.POSTED],
    )) as { currencyCode: string; amount: string; baseAmount: string }[];

    return rows.map((row) => ({
      currencyCode: row.currencyCode,
      amount: roundAmount(Number(row.amount)),
      baseAmount: roundAmount(Number(row.baseAmount)),
    }));
  }

  /**
   * `REC-2026-000042`. Consecutive per tenant and year.
   *
   * A receipt is a document a customer keeps and quotes back; eight characters of a UUID — which is
   * what the list screen expected to render — is not a reference anyone can use.
   */
  private nextReceiptNumber(
    manager: EntityManager,
    organizationId: string,
    date: Date | string,
  ): Promise<string> {
    return this.numbering.allocateForScope(
      manager,
      organizationId,
      SEQUENCE_SCOPE.CUSTOMER_RECEIPT,
      'REC',
      Number(toIsoDate(date).slice(0, 4)),
    );
  }
}
