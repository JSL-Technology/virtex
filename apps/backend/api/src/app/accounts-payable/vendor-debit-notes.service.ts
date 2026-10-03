
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
  InternalServerError,
  NotFoundError,
} from '../i18n/localized.exception';
import { VoidVendorDebitNoteDto } from './dto/void-vendor-debit-note.dto';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { LedgerLookupService } from '../accounting/services/ledger-lookup.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { OrgSettingsService } from '../organizations/services/org-settings.service';

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

  async create(
    dto: CreateVendorDebitNoteDto,
    organizationId: string,
  ): Promise<VendorDebitNote> {
    return this.dataSource.transaction(async (manager) => {
      const { vendorBillId, amount, reason, expenseAccountId } = dto;

      // Locked: two notes against the same bill must not both read the old balance.
      await this.lockBill(manager, vendorBillId, organizationId);
      const vendorBill = await manager.findOne(VendorBill, { where: { id: vendorBillId, organizationId } });
      if (!vendorBill) {
        throw new NotFoundError('accounts_payable.vendor_bill_not_found');
      }
      if (vendorBill.status !== VendorBillStatus.OPEN && vendorBill.status !== VendorBillStatus.PARTIALLY_PAID) {
          throw new BadRequestError('accounts_payable.debit_notes_can_only_applied_open');
      }
      if (vendorBill.balance < amount) {
        throw new BadRequestError('accounts_payable.debit_note_cannot_larger_than_invoice');
      }

      const settings = await this.orgSettings.getForOrg(organizationId, manager);
      if (!settings || !settings.defaultAccountsPayableId) {
        throw new BadRequestError('accounts_payable.default_payable_account_not_configured');
      }

      const defaultLedger = await this.ledgerLookup.requireDefault(organizationId, manager);

      const journal = await this.journalLookup.requireByCode(organizationId, 'COMPRAS', manager);

      const debitNote = manager.create(VendorDebitNote, {
        vendorBillId,
        reason,
        amount,
        organizationId,
        date: new Date(),
        status: VendorDebitNoteStatus.POSTED,
      });
      const savedDebitNote = await manager.save(debitNote);

      vendorBill.balance = Math.round((Number(vendorBill.balance) - amount) * 100) / 100;
      // A note that takes the balance to zero settles the bill. It used to stay OPEN at zero, so
      // it kept appearing among the bills to pay and in the ageing, owing nothing.
      if (vendorBill.balance <= 0) vendorBill.status = VendorBillStatus.PAID;
      await manager.save(vendorBill);

      if (!manager.queryRunner) {
        throw new InternalServerError('accounts_payable.transaction_query_runner_could_not_obtained');
      }

      const words = await this.narrative.describeAll(manager, organizationId, {
        header: { key: 'ledger.debit_note.vendor_entry', params: { reason } },
        payable: {
          key: 'ledger.debit_note.vendor_payable',
          params: { bill: vendorBill.ncf || vendorBill.id.substring(0, 8) },
        },
        counterpart: { key: 'ledger.debit_note.vendor_counterpart', params: { reason } },
      });

      const entryDto: CreateJournalEntryDto = {
          date: new Date().toISOString(),
          description: words.header,
          journalId: journal.id,
          lines: [
            {
              accountId: settings.defaultAccountsPayableId,
              debit: amount,
              credit: 0,
              description: words.payable,
              valuations: [{
                ledgerId: defaultLedger.id,
                debit: amount,
                credit: 0
              }]
            },
            {
              accountId: expenseAccountId,
              debit: 0,
              credit: amount,
              description: words.counterpart,
              valuations: [{
                ledgerId: defaultLedger.id,
                debit: 0,
                credit: amount
              }]
            },
          ],
      };

      const entry = await this.journalEntriesService.createWithQueryRunner(
        manager.queryRunner,
        entryDto,
        organizationId,
      );
      // Recorded so the note can be voided by reversing exactly what it posted.
      savedDebitNote.journalEntryId = entry.id;
      await manager.update(VendorDebitNote, { id: savedDebitNote.id }, { journalEntryId: entry.id });

      this.logger.log(`Nota de débito ${savedDebitNote.id} creada exitosamente.`);
      return savedDebitNote;
    });
  }

  findAll(organizationId: string): Promise<VendorDebitNote[]> {
    return this.vendorDebitNoteRepository.find({
      where: { organizationId },
      order: { date: 'DESC' },
    });
  }

  async findOne(
    id: string,
    organizationId: string,
  ): Promise<VendorDebitNote> {
    const debitNote = await this.vendorDebitNoteRepository.findOne({
      where: { id, organizationId },
    });
    if (!debitNote) {
      throw new NotFoundError('accounts_payable.debit_note_id_not_found', { id });
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

      bill.balance = Math.round((Number(bill.balance) + Number(note.amount)) * 100) / 100;
      if (bill.balance > 0) {
        // Owing again: in full if nothing else has reduced it, in part if a payment has.
        bill.status =
          bill.balance >= Number(bill.total) ? VendorBillStatus.OPEN : VendorBillStatus.PARTIALLY_PAID;
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
