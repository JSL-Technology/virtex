import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import {
  PurchaseFiscalDocument,
  PurchaseFiscalQuery,
  PurchaseFiscalRecordsSource,
} from '../contracts/fiscal-records/purchase-fiscal-records.contract';
import { PurchaseFiscalRecordsRegistry } from '../contracts/fiscal-records/purchase-fiscal-records.registry';
import { roundAmount } from '../common/money';
import { toIsoDate } from '../common/dates';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { VendorDebitNote, VendorDebitNoteStatus } from './entities/vendor-debit-note.entity';

const NOT_ISSUED = [VendorBillStatus.DRAFT, VendorBillStatus.VOID, VendorBillStatus.REJECTED];

/**
 * What Purchasing tells a purchases return: the supplier bills and credit notes of a period, with
 * their fiscal numbers and figures. See `PurchaseFiscalRecordsSource`.
 */
@Injectable()
export class PurchaseFiscalRecordsProvider implements PurchaseFiscalRecordsSource, OnModuleInit {
  readonly sourceName = 'accounts-payable';

  constructor(
    @InjectRepository(VendorBill)
    private readonly bills: Repository<VendorBill>,
    @InjectRepository(VendorDebitNote)
    private readonly debitNotes: Repository<VendorDebitNote>,
    private readonly registry: PurchaseFiscalRecordsRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async fiscalDocuments(query: PurchaseFiscalQuery): Promise<PurchaseFiscalDocument[]> {
    const [bills, notes, paymentCodes] = await Promise.all([
      this.bills.find({
        relations: ['vendor'],
        where: {
          organizationId: query.organizationId,
          date: Between(query.from, query.to),
          supplierFiscalNumber: Not(IsNull()),
          status: Not(In(NOT_ISSUED)),
        },
        order: { date: 'ASC', supplierFiscalNumber: 'ASC' },
      }),
      // A voided note is left out the way a voided bill is: the reversal took its effect back.
      this.debitNotes.find({
        relations: ['vendorBill', 'vendorBill.vendor'],
        where: {
          organizationId: query.organizationId,
          date: Between(query.from, query.to),
          supplierFiscalNumber: Not(IsNull()),
          status: VendorDebitNoteStatus.POSTED,
        },
        order: { date: 'ASC', number: 'ASC' },
      }),
      this.paymentFiscalCodes(query.organizationId),
    ]);

    // One chronology: a note sits after the bills of its own day, as it was received after them.
    return [...bills.map((bill) => fromBill(bill, paymentCodes)), ...notes.map(fromCreditNote)]
      .map((document, index) => ({ document, index }))
      .sort((a, b) => a.document.date.localeCompare(b.document.date) || a.index - b.index)
      .map(({ document }) => document);
  }

  async foreignPurchases(query: PurchaseFiscalQuery, homeCountry: string): Promise<PurchaseFiscalDocument[]> {
    const bills = await this.bills
      .createQueryBuilder('bill')
      .innerJoinAndSelect('bill.vendor', 'vendor')
      .where('bill.organizationId = :organizationId', { organizationId: query.organizationId })
      .andWhere('bill.date BETWEEN :fromDate AND :toDate', { fromDate: query.from, toDate: query.to })
      .andWhere('bill.status NOT IN (:...excluded)', { excluded: NOT_ISSUED })
      .andWhere('UPPER(COALESCE(vendor.country, :home)) <> :home', { home: homeCountry.toUpperCase() })
      .orderBy('bill.date', 'ASC')
      .addOrderBy('bill.id', 'ASC')
      .getMany();
    const paymentCodes = await this.paymentFiscalCodes(query.organizationId);
    return bills.map((bill) => fromBill(bill, paymentCodes));
  }

  /**
   * The authority's code for each of the company's payment methods, where its market publishes a
   * catalogue (`payment_methods.fiscal_code`).
   *
   * Read by SQL, scoped to the tenant: the catalogue is Treasury's table and a purchases return is
   * not a reason for Purchasing to depend on Treasury. The purchase records which method settled it,
   * as the invoice does on the sales side; what an authority calls that method is the method's own.
   */
  private async paymentFiscalCodes(organizationId: string): Promise<ReadonlyMap<string, string>> {
    const rows: Array<{ code: string; fiscal_code: string | null }> = await this.bills.manager.query(
      `SELECT "code", "fiscal_code" FROM "payment_methods" WHERE "organization_id" = $1`,
      [organizationId],
    );
    return new Map(rows.filter((row) => row.fiscal_code).map((row) => [row.code, row.fiscal_code as string]));
  }
}

function fromBill(bill: VendorBill, paymentCodes: ReadonlyMap<string, string>): PurchaseFiscalDocument {
  return {
    kind: 'bill',
    // A bill carries no number of the product's own: the supplier's document names it, or its id.
    reference: bill.supplierFiscalNumber ?? bill.id,
    supplierName: bill.vendor?.name ?? null,
    supplierTaxId: bill.vendor?.taxId ?? null,
    supplierCountry: bill.vendor?.country ?? null,
    fiscalNumber: bill.supplierFiscalNumber ?? null,
    modifiedFiscalNumber: bill.modifiedSupplierFiscalNumber ?? null,
    date: toIsoDate(bill.date),
    paidOn: bill.paidAt ? toIsoDate(bill.paidAt) : null,
    fiscalAttributes: bill.fiscalAttributes ?? {},
    paymentFiscalCode: (bill.paymentMethodCode && paymentCodes.get(bill.paymentMethodCode)) || null,
    servicesAmount: num(bill.servicesAmount),
    goodsAmount: num(bill.goodsAmount),
    taxAmount: num(bill.taxAmount),
    taxWithheld: num(bill.taxWithheld),
    taxProportional: num(bill.taxProportional),
    taxToCost: num(bill.taxToCost),
    incomeTaxWithheld: num(bill.incomeTaxWithheld),
    exciseAmount: num(bill.exciseAmount),
    otherTaxes: num(bill.otherTaxes),
    serviceCharge: num(bill.serviceCharge),
    total: num(bill.total),
  };
}

/**
 * A supplier's credit note, as the 606 reports it: its own NCF, the bill's as the one it modifies,
 * the tax it gives back, and its amount before tax split between services and goods the way the
 * bill was.
 */
function fromCreditNote(note: VendorDebitNote): PurchaseFiscalDocument {
  const bill = note.vendorBill;
  const { services, goods } = splitLikeBill(note, bill);
  return {
    kind: 'credit_note',
    reference: note.number,
    supplierName: bill?.vendor?.name ?? null,
    supplierTaxId: bill?.vendor?.taxId ?? null,
    supplierCountry: bill?.vendor?.country ?? null,
    fiscalNumber: note.supplierFiscalNumber,
    modifiedFiscalNumber: bill?.supplierFiscalNumber ?? null,
    date: toIsoDate(note.date),
    paidOn: null,
    // The note is classified as the purchase it corrects, and how that purchase was paid is not
    // what a note says: a return that codes a note on that column codes it itself.
    fiscalAttributes: bill?.fiscalAttributes ?? {},
    paymentFiscalCode: null,
    servicesAmount: services,
    goodsAmount: goods,
    taxAmount: num(note.taxAmount),
    taxWithheld: 0,
    taxProportional: 0,
    taxToCost: 0,
    incomeTaxWithheld: 0,
    exciseAmount: 0,
    otherTaxes: 0,
    serviceCharge: 0,
    total: num(note.amount),
  };
}

/**
 * The note records one amount; the return wants services and goods apart, and the bill's own
 * proportion is the only split that is not invented. A bill with neither figure recorded — one
 * entered before the split existed — puts the whole amount under goods, its default
 * classification. Goods take the rounding remainder, so the two always add up.
 */
export function splitLikeBill(
  note: Pick<VendorDebitNote, 'amount' | 'taxAmount'>,
  bill: Pick<VendorBill, 'servicesAmount' | 'goodsAmount'> | undefined,
): { services: number; goods: number } {
  const net = roundAmount(num(note.amount) - num(note.taxAmount));
  const billServices = num(bill?.servicesAmount);
  const billNet = roundAmount(billServices + num(bill?.goodsAmount));
  if (billNet <= 0) return { services: 0, goods: net };
  const services = roundAmount((net * billServices) / billNet);
  return { services, goods: roundAmount(net - services) };
}

function num(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}
