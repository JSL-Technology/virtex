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
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  JournalEntryNumberingService,
  SEQUENCE_SCOPE,
} from '../journal-entries/journal-entry-numbering.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountRole } from '../chart-of-accounts/enums/account-enums';
import { ModuleSlug } from '../accounting/entities/accounting-period.entity';
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
import { toIsoDate } from '../chart-of-accounts/account-balances.service';
import { AgingBucket, AgingRow } from '../accounts-payable/accounts-payable.service';

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
    private readonly journalEntriesService: JournalEntriesService,
    private readonly numbering: JournalEntryNumberingService,
    private readonly exchangeRates: ExchangeRateResolver,
    private readonly dataSource: DataSource,
  ) {}

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
          'CUSTOMERS.CUENTA_COBRAR_DEFECTO_NO_ESTA_CONFIGURADA_ORGANIZACION',
        );
      }
      const baseCurrency = settings.baseCurrency ?? 'USD';
      const currencyCode = (dto.currencyCode ?? baseCurrency).toUpperCase();

      const customer = await manager.findOneBy(Customer, {
        id: dto.customerId,
        organizationId,
      });
      if (!customer) throw new NotFoundError('CUSTOMERS.CLIENTE_NO_ENCONTRADO');

      const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!ledger) {
        throw new BadRequestError(
          'CUSTOMERS.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
        );
      }

      const collectionJournal = await manager.findOneBy(Journal, {
        organizationId,
        code: 'COBROS',
      });
      if (!collectionJournal) {
        throw new BadRequestError('CUSTOMERS.DIARIO_COBROS_COBROS_NO_ENCONTRADO_FAVOR_CREE');
      }

      const bankAccount = await manager.findOneBy(Account, {
        id: dto.bankAccountId,
        organizationId,
      });
      if (!bankAccount) throw new BadRequestError('CUSTOMERS.CUENTA_BANCARIA_NO_VALIDA');

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
          throw new BadRequestError('CUSTOMERS.MAS_FACTURAS_NO_SON_VALIDAS_NO_PERTENECEN');
        }
        if (
          invoice.status !== InvoiceStatus.PENDING &&
          invoice.status !== InvoiceStatus.PARTIALLY_PAID
        ) {
          throw new BadRequestError('CUSTOMERS.FACTURA_NO_ADMITE_COBRO', {
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
          throw new BadRequestError('CUSTOMERS.MONTO_PAGO_FACTURA_EXCEDE_SALDO_PENDIENTE', {
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

      // Anything received beyond what was applied is held as a customer advance.
      const unapplied = roundAmount(dto.amountReceived - appliedInReceiptCurrency);
      if (toCents(unapplied) < 0) {
        throw new BadRequestError('CUSTOMERS.APLICACION_EXCEDE_MONTO_RECIBIDO', {
          received: dto.amountReceived,
          applied: appliedInReceiptCurrency,
        });
      }
      const unappliedBase = convert(unapplied, receiptRate);
      cashInBase = roundAmount(cashInBase + unappliedBase);
      payment.unappliedAmount = unapplied;

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

      push(dto.bankAccountId, cashInBase, 0, 'Ingreso a banco por cobro a cliente');
      push(
        settings.defaultAccountsReceivableId,
        0,
        receivableCreditBase,
        `Cancelación de cuentas por cobrar — ${customer.companyName ?? customer.id}`,
      );

      if (toCents(withheldTaxBase) !== 0 || toCents(withheldIncomeBase) !== 0) {
        const withholdingReceivableId = await this.resolveAccount(
          manager,
          organizationId,
          AccountRole.WITHHOLDING_RECEIVABLE,
          settings.defaultTaxWithheldReceivableId,
        );
        if (!withholdingReceivableId) {
          throw new BadRequestError('CUSTOMERS.CUENTA_RETENCIONES_RECIBIDAS_NO_CONFIGURADA');
        }
        // An asset: the customer paid it to the authority on our behalf and we recover it.
        push(
          withholdingReceivableId,
          roundAmount(withheldTaxBase + withheldIncomeBase),
          0,
          'Retenciones practicadas por el cliente',
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
          throw new BadRequestError('CUSTOMERS.CUENTA_DESCUENTOS_NO_CONFIGURADA');
        }
        push(discountAccountId, discountBase, 0, 'Descuento por pronto pago concedido');
      }

      if (toCents(unappliedBase) !== 0) {
        const advanceAccountId = await this.resolveAdvanceAccount(
          manager,
          organizationId,
          settings,
        );
        // Held, not earned: money against no document is owed back until it is applied.
        push(advanceAccountId, 0, unappliedBase, 'Anticipo de cliente');
      }

      if (toCents(exchangeDifferenceBase) !== 0) {
        const forexAccountId = await this.resolveAccount(
          manager,
          organizationId,
          AccountRole.FOREX_GAIN_LOSS,
          settings.defaultForexGainLossAccountId,
        );
        if (!forexAccountId) {
          throw new BadRequestError('CUSTOMERS.CUENTA_DIFERENCIA_CAMBIARIA_NO_CONFIGURADA');
        }
        push(
          forexAccountId,
          exchangeDifferenceBase > 0 ? exchangeDifferenceBase : 0,
          exchangeDifferenceBase < 0 ? Math.abs(exchangeDifferenceBase) : 0,
          'Diferencia cambiaria realizada en el cobro',
        );
      }

      const entry = await this.journalEntriesService.createWithManager(
        manager,
        {
          date: toIsoDate(dto.paymentDate),
          description: `Recibo de cobro ${payment.receiptNumber ?? payment.id.slice(0, 8)}`,
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
      if (!payment) throw new NotFoundError('CUSTOMERS.COBRO_NO_ENCONTRADO');
      if (payment.status === CustomerPaymentStatus.VOID) {
        throw new BadRequestError('CUSTOMERS.COBRO_YA_ANULADO');
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
        const reversal = await this.journalEntriesService.createSystemReversal(
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
    if (!payment) throw new NotFoundError('CUSTOMERS.COBRO_NO_ENCONTRADO');
    return payment;
  }

  /** What customers owe, by customer and by how overdue it is. */
  async aging(
    organizationId: string,
    asOf: Date | string = new Date(),
  ): Promise<{
    asOfDate: string;
    rows: AgingRow[];
    totals: { current: number; buckets: AgingBucket[]; total: number };
  }> {
    const asOfDate = toIsoDate(asOf);
    const invoices = await this.dataSource.getRepository(Invoice).find({
      where: {
        organizationId,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID]),
      },
      relations: ['customer'],
    });

    const cutoff = new Date(`${asOfDate}T00:00:00.000Z`).getTime();
    const byCustomer = new Map<string, AgingRow>();

    for (const invoice of invoices) {
      if (toCents(invoice.balance) === 0) continue;
      const dueDate = invoice.dueDate ?? invoice.issueDate;
      const due = new Date(`${toIsoDate(dueDate)}T00:00:00.000Z`).getTime();
      const daysOverdue = Math.floor((cutoff - due) / 86_400_000);
      const amount = convert(invoice.balance, Number(invoice.exchangeRate) || 1);

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
    return {
      asOfDate,
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
   * Where a customer advance is held.
   *
   * There is no dedicated role for it, so the receivable account is used as a contra: an advance
   * sits as a credit balance against the customer until it is applied. A tenant that wants it on a
   * separate liability line assigns one; until then this keeps the money visible and owed rather
   * than recognised as income.
   */
  private async resolveAdvanceAccount(
    manager: EntityManager,
    organizationId: string,
    settings: OrganizationSettings,
  ): Promise<string> {
    const receivableId = await this.resolveAccount(
      manager,
      organizationId,
      AccountRole.ACCOUNTS_RECEIVABLE,
      settings.defaultAccountsReceivableId,
    );
    if (!receivableId) {
      throw new BadRequestError(
        'CUSTOMERS.CUENTA_COBRAR_DEFECTO_NO_ESTA_CONFIGURADA_ORGANIZACION',
      );
    }
    return receivableId;
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
