
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { VendorDebitNote, VendorDebitNoteStatus } from './entities/vendor-debit-note.entity';
import { CreateVendorDebitNoteDto } from './dto/create-vendor-debit-note.dto';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { AccountingPostingPort, ModuleSlug } from '../journal-entries/accounting-posting.port';
import { UpdateVendorDebitNoteDto } from './dto/update-vendor-debit-note.dto';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';
import { VoidVendorDebitNoteDto } from './dto/void-vendor-debit-note.dto';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { LedgerLookupService } from '../accounting/services/ledger-lookup.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { roundAmount, toCents } from '../common/money';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { applyBranchScope, assertDocumentInScope, loadBranchScope } from '../organizations/contracts/branch.contract';
import { assertPostableAccount, resolvePurchaseTaxAccount } from './payables-accounts';
import { VendorDebitNoteQueryDto } from './dto/vendor-debit-note-query.dto';
import { billPayable } from './vendor-bill-balance';

/** One page of a list. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** A debit note as the list shows it: with the bill and supplier it belongs to. */
export interface VendorDebitNoteRow {
  id: string;
  number: string;
  date: string;
  reason: string;
  ncf: string | null;
  amount: number;
  taxAmount: number;
  status: VendorDebitNoteStatus;
  branchId: string | null;
  journalEntryId: string | null;
  vendorBillId: string;
  billNcf: string | null;
  currencyCode: string;
  supplierId: string | null;
  supplierName: string | null;
}

@Injectable()
export class VendorDebitNotesService {
  private readonly logger = new Logger(VendorDebitNotesService.name);

  constructor(
    @InjectRepository(VendorDebitNote)
    private vendorDebitNoteRepository: Repository<VendorDebitNote>,
    private dataSource: DataSource,
    private journalEntriesService: AccountingPostingPort,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService,
    private readonly ledgerLookup: LedgerLookupService,
    private readonly journalLookup: JournalLookupService,
    private readonly orgSettings: OrgSettingsService,
  ) {}

  /**
   * Issue a note against one bill and post it.
   *
   * Dr Payables for the whole amount; Cr input tax for the tax part (the credit the bill took is
   * given back) and Cr the account the bill charged for the rest. In the bill's currency at the
   * bill's own rate, so the payable is relieved at exactly the value it was booked at and no
   * exchange difference appears where no cash moved.
   */
  async create(
    dto: CreateVendorDebitNoteDto,
    organizationId: string,
    actorUserId: string | null = null,
  ): Promise<VendorDebitNote> {
    return this.dataSource.transaction(async (manager) => {
      const { vendorBillId, reason } = dto;
      const amount = roundAmount(dto.amount);
      const taxAmount = roundAmount(dto.taxAmount ?? 0);

      // Locked: two notes against the same bill must not both read the old balance.
      await this.lockBill(manager, vendorBillId, organizationId);
      const vendorBill = await manager.findOne(VendorBill, {
        where: { id: vendorBillId, organizationId },
        relations: ['vendor'],
      });
      if (!vendorBill) {
        throw new NotFoundError('accounts_payable.vendor_bill_not_found');
      }
      // A restricted person raises notes only on the bills of branches they can open.
      assertDocumentInScope(await loadBranchScope(manager, organizationId, actorUserId), vendorBill.branchId);
      if (vendorBill.status !== VendorBillStatus.OPEN && vendorBill.status !== VendorBillStatus.PARTIALLY_PAID) {
        throw new BadRequestError('accounts_payable.debit_notes_can_only_applied_open');
      }
      if (toCents(amount) > toCents(vendorBill.balance)) {
        throw new BadRequestError('accounts_payable.debit_note_cannot_larger_than_invoice');
      }
      if (toCents(taxAmount) >= toCents(amount)) {
        throw new BadRequestError('accounts_payable.debit_note_tax_exceeds_amount');
      }
      if (toCents(taxAmount) > 0) {
        // No more tax can be given back than the bill claimed as a credit, net of earlier notes.
        const deductible = roundAmount(vendorBill.taxAmount - vendorBill.taxToCost - vendorBill.taxProportional);
        const [{ returned }] = await manager.query<{ returned: string | null }[]>(
          `SELECT COALESCE(SUM("tax_amount"), 0) AS returned FROM "vendor_debit_note"
            WHERE "organization_id" = $1 AND "vendor_bill_id" = $2 AND "status" = $3`,
          [organizationId, vendorBillId, VendorDebitNoteStatus.POSTED],
        );
        const available = roundAmount(deductible - Number(returned ?? 0));
        if (toCents(taxAmount) > toCents(available)) {
          throw new BadRequestError('accounts_payable.debit_note_tax_exceeds_bill_tax', { available });
        }
      }
      await assertPostableAccount(manager, organizationId, dto.expenseAccountId);

      const settings = await this.orgSettings.getForOrg(organizationId, manager);
      if (!settings || !settings.defaultAccountsPayableId) {
        throw new BadRequestError('accounts_payable.default_payable_account_not_configured');
      }
      const taxAccountId =
        toCents(taxAmount) > 0
          ? await resolvePurchaseTaxAccount(manager, organizationId, settings.defaultPurchaseTaxId)
          : null;
      if (toCents(taxAmount) > 0 && !taxAccountId) {
        throw new BadRequestError('accounts_payable.no_purchase_tax_account_configured_bill');
      }

      const defaultLedger = await this.ledgerLookup.requireDefault(organizationId, manager);
      const journal = await this.journalLookup.requireByCode(organizationId, 'COMPRAS', manager);

      const date = dto.date ? dto.date.slice(0, 10) : await organizationToday(manager, organizationId);
      const number = await allocateDocumentNumber(
        manager,
        organizationId,
        DOCUMENT_SEQUENCE_SCOPE.VENDOR_DEBIT_NOTE,
        'ND',
        Number(date.slice(0, 4)),
      );

      const savedDebitNote = await manager.save(
        manager.create(VendorDebitNote, {
          organizationId,
          number,
          vendorBillId,
          branchId: vendorBill.branchId ?? null,
          reason,
          ncf: dto.ncf ? dto.ncf.toUpperCase() : null,
          amount,
          taxAmount,
          expenseAccountId: dto.expenseAccountId,
          date,
          createdByUserId: actorUserId,
          status: VendorDebitNoteStatus.POSTED,
        }),
      );

      vendorBill.balance = roundAmount(Number(vendorBill.balance) - amount);
      // A note that takes the balance to zero settles the bill. It used to stay OPEN at zero, so
      // it kept appearing among the bills to pay and in the ageing, owing nothing.
      if (toCents(vendorBill.balance) <= 0) vendorBill.status = VendorBillStatus.PAID;
      await manager.save(vendorBill);

      const words = await this.narrative.describeAll(manager, organizationId, {
        header: { key: 'ledger.debit_note.vendor_entry', params: { reason: `${number} · ${reason}` } },
        payable: {
          key: 'ledger.debit_note.vendor_payable',
          params: { bill: vendorBill.ncf || vendorBill.id.substring(0, 8) },
        },
        counterpart: { key: 'ledger.debit_note.vendor_counterpart', params: { reason } },
        tax: { key: 'ledger.debit_note.vendor_tax_returned' },
      });

      const line = (accountId: string, debit: number, credit: number, description: string) => ({
        accountId,
        debit,
        credit,
        description,
        valuations: [{ ledgerId: defaultLedger.id, debit, credit }],
      });
      const lines = [line(settings.defaultAccountsPayableId, amount, 0, words.payable)];
      if (taxAccountId && toCents(taxAmount) > 0) lines.push(line(taxAccountId, 0, taxAmount, words.tax));
      lines.push(line(dto.expenseAccountId, 0, roundAmount(amount - taxAmount), words.counterpart));

      const entry = await this.journalEntriesService.createWithManager(
        manager,
        {
          date,
          description: words.header,
          journalId: journal.id,
          lines,
          currencyCode: vendorBill.currencyCode,
          exchangeRate: vendorBill.exchangeRate,
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId, module: ModuleSlug.AP, systemReason: 'vendor-debit-note' },
      );
      // Recorded so the note can be voided by reversing exactly what it posted.
      savedDebitNote.journalEntryId = entry.id;
      await manager.update(VendorDebitNote, { id: savedDebitNote.id }, { journalEntryId: entry.id });

      this.logger.log(`Nota de débito ${number} sobre ${vendorBill.id} contabilizada en ${entry.id}.`);
      return savedDebitNote;
    });
  }

  async findAll(
    organizationId: string,
    query: VendorDebitNoteQueryDto = {},
    actorUserId?: string,
  ): Promise<Paged<VendorDebitNoteRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const qb = this.vendorDebitNoteRepository
      .createQueryBuilder('note')
      .innerJoin('note.vendorBill', 'bill')
      .leftJoin('bill.vendor', 'vendor')
      .select([
        'note.id AS "id"',
        'note.number AS "number"',
        'note.reason AS "reason"',
        'note.ncf AS "ncf"',
        'note.amount AS "amount"',
        'note.taxAmount AS "taxAmount"',
        'note.status AS "status"',
        'note.branchId AS "branchId"',
        'note.journalEntryId AS "journalEntryId"',
        'bill.id AS "vendorBillId"',
        'bill.ncf AS "billNcf"',
        'bill.currencyCode AS "currencyCode"',
        'vendor.id AS "supplierId"',
        'vendor.name AS "supplierName"',
      ])
      // As text: a raw `date` comes back from the driver as a local-time Date.
      .addSelect(`TO_CHAR(note.date, 'YYYY-MM-DD')`, 'date')
      .where('note.organizationId = :organizationId', { organizationId });
    if (query.supplierId) qb.andWhere('bill.vendorId = :supplierId', { supplierId: query.supplierId });
    if (query.vendorBillId) qb.andWhere('note.vendorBillId = :vendorBillId', { vendorBillId: query.vendorBillId });
    if (query.status) qb.andWhere('note.status = :status', { status: query.status });
    if (query.from) qb.andWhere('note.date >= :from', { from: query.from.slice(0, 10) });
    if (query.to) qb.andWhere('note.date <= :to', { to: query.to.slice(0, 10) });
    if (actorUserId || query.branchId) {
      const scope = await loadBranchScope(this.dataSource.manager, organizationId, actorUserId ?? null);
      applyBranchScope(qb, 'note', scope, query.branchId);
    }
    const total = await qb.getCount();
    const rows = await qb
      .orderBy('note.date', 'DESC')
      .addOrderBy('note.number', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<VendorDebitNoteRow>();
    const items = rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      taxAmount: Number(row.taxAmount),
    }));
    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async findOne(
    id: string,
    organizationId: string,
    actorUserId?: string,
  ): Promise<VendorDebitNote> {
    const debitNote = await this.vendorDebitNoteRepository.findOne({
      where: { id, organizationId },
      relations: ['vendorBill', 'vendorBill.vendor'],
    });
    if (!debitNote) {
      throw new NotFoundError('accounts_payable.debit_note_id_not_found', { id });
    }
    if (actorUserId) {
      assertDocumentInScope(await loadBranchScope(this.dataSource.manager, organizationId, actorUserId), debitNote.branchId);
    }
    return debitNote;
  }

  /**
   * A posted debit note does not change.
   *
   * This merged the request into the note and saved it: a new amount left the entry it had posted
   * and the bill's balance saying the old one, and a new bill moved the note without moving the
   * money. Every accounting product treats an issued note the same way — void it and issue the
   * correct one — and so does this.
   */
  async update(
    id: string,
    _updateDto: UpdateVendorDebitNoteDto,
    organizationId: string,
  ): Promise<VendorDebitNote> {
    await this.findOne(id, organizationId);
    throw new ForbiddenError('accounts_payable.debit_note_posted_is_immutable');
  }

  /**
   * Deleting a posted note is refused, for the same reason a posted bill cannot be deleted: its
   * entry is in the ledger, and the supplier's balance already reflects it. Void it instead.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);
    throw new ForbiddenError('accounts_payable.debit_note_delete_use_void');
  }

  /**
   * Void a posted debit note: reverse its entry and give the bill back what the note took off.
   *
   * It was a stub that logged a warning and refused, so an issued note could not be corrected at
   * all — except by deleting it, which left its entry behind. Mirrors `voidBill`: the reversal is
   * booked on the date the caller states (today by default), the reason, time and author stay on
   * the note, and the bill and the note are locked so a payment or a second void cannot race it.
   */
  async voidNote(
    id: string,
    organizationId: string,
    dto: VoidVendorDebitNoteDto,
    actorUserId: string | null,
  ): Promise<VendorDebitNote> {
    const reason = dto.reason.trim();
    return this.dataSource.transaction(async (manager) => {
      const note = await manager.findOne(VendorDebitNote, {
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!note) throw new NotFoundError('accounts_payable.debit_note_id_not_found', { id });
      if (note.status === VendorDebitNoteStatus.VOIDED) {
        throw new ConflictError('accounts_payable.debit_note_already_voided');
      }
      if (!note.journalEntryId) {
        // Issued before notes recorded their entry: which entry is theirs cannot be told for
        // certain, and reversing the wrong one is worse than asking a person to choose.
        throw new BadRequestError('accounts_payable.debit_note_without_entry_reverse_manually');
      }

      await this.lockBill(manager, note.vendorBillId, organizationId);
      const bill = await manager.findOne(VendorBill, { where: { id: note.vendorBillId, organizationId } });
      if (!bill) throw new NotFoundError('accounts_payable.vendor_bill_not_found');
      if (bill.status === VendorBillStatus.VOID) {
        // The bill's own void already cleared what it owed; restoring the note's amount would
        // make a voided bill owe money again.
        throw new BadRequestError('accounts_payable.debit_note_bill_already_voided');
      }

      const reversal = await this.journalEntriesService.createSystemReversal(
        note.journalEntryId,
        organizationId,
        {
          reversalDate: (dto.reversalDate ?? new Date().toISOString()).slice(0, 10),
          reason: `Anulación de nota de débito: ${reason}`,
        },
        manager,
        { actorUserId, module: ModuleSlug.AP, systemReason: 'vendor-debit-note-void' },
      );

      bill.balance = roundAmount(Number(bill.balance) + Number(note.amount));
      if (toCents(bill.balance) > 0) {
        // Owing again: in full if nothing else has reduced it, in part if a payment has. «In full»
        // is what the bill made payable — its total less what was withheld from the supplier — not
        // its total, or a bill with withholding never returns to OPEN.
        bill.status =
          toCents(bill.balance) >= toCents(billPayable(bill)) ? VendorBillStatus.OPEN : VendorBillStatus.PARTIALLY_PAID;
        bill.paidAt = null;
      }
      await manager.save(bill);

      note.status = VendorDebitNoteStatus.VOIDED;
      note.reversalJournalEntryId = reversal.id;
      note.voidReason = reason;
      note.voidedAt = new Date();
      note.voidedByUserId = actorUserId;
      return manager.save(note);
    });
  }

  /**
   * Locks the bill's own row for the rest of the transaction, so two notes — or a note and a
   * payment — cannot both read the same balance. By id rather than through `findOne({ lock })`:
   * the bill's eager relations load through outer joins, which PostgreSQL refuses to lock.
   */
  private async lockBill(manager: EntityManager, id: string, organizationId: string): Promise<void> {
    await manager.query(`SELECT id FROM vendor_bills WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [
      id,
      organizationId,
    ]);
  }
}
