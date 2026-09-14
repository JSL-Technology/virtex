
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { VendorDebitNote } from './entities/vendor-debit-note.entity';
import { CreateVendorDebitNoteDto } from './dto/create-vendor-debit-note.dto';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { UpdateVendorDebitNoteDto } from './dto/update-vendor-debit-note.dto';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class VendorDebitNotesService {
  private readonly logger = new Logger(VendorDebitNotesService.name);

  constructor(
    @InjectRepository(VendorDebitNote)
    private vendorDebitNoteRepository: Repository<VendorDebitNote>,
    private dataSource: DataSource,
    private journalEntriesService: JournalEntriesService,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(
      new I18nService(),
    ),
  ) {}

  async create(
    dto: CreateVendorDebitNoteDto,
    organizationId: string,
  ): Promise<VendorDebitNote> {
    return this.dataSource.transaction(async (manager) => {
      const { vendorBillId, amount, reason, expenseAccountId } = dto;

      const vendorBill = await manager.findOneBy(VendorBill, {
        id: vendorBillId,
        organizationId,
      });
      if (!vendorBill) {
        throw new NotFoundError('accounts_payable.vendor_bill_not_found');
      }
      if (vendorBill.status !== VendorBillStatus.OPEN && vendorBill.status !== VendorBillStatus.PARTIALLY_PAID) {
          throw new BadRequestError('accounts_payable.debit_notes_can_only_applied_open');
      }
      if (vendorBill.balance < amount) {
        throw new BadRequestError('accounts_payable.debit_note_cannot_larger_than_invoice');
      }

      const settings = await manager.findOneBy(OrganizationSettings, {
        organizationId,
      });
      if (!settings || !settings.defaultAccountsPayableId) {
        throw new BadRequestError('accounts_payable.default_payable_account_not_configured');
      }

      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        throw new BadRequestError('accounts_payable.no_default_ledger_has_configured_organization');
      }

      const journal = await manager.findOneBy(Journal, { organizationId, code: 'COMPRAS' });
      if (!journal) {
          throw new BadRequestError('accounts_payable.purchases_journal_compras_not_found_record');
      }

      const debitNote = manager.create(VendorDebitNote, {
        ...dto,
        organizationId,
        date: new Date(),
      });
      const savedDebitNote = await manager.save(debitNote);

      vendorBill.balance -= amount;
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

      await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);

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

  async update(
    id: string,
    updateDto: UpdateVendorDebitNoteDto,
    organizationId: string,
  ): Promise<VendorDebitNote> {
    const debitNote = await this.findOne(id, organizationId);
    const updatedNote = this.vendorDebitNoteRepository.merge(
      debitNote,
      updateDto,
    );
    return this.vendorDebitNoteRepository.save(updatedNote);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.vendorDebitNoteRepository.delete({ id, organizationId });
    if (result.affected === 0) {
      throw new NotFoundError('accounts_payable.debit_note_id_not_found', { id });
    }
  }

  async voidNote(
    id: string,
    organizationId: string,
    reason: string,
  ): Promise<{ message: string }> {
    const debitNote = await this.findOne(id, organizationId);
    this.logger.warn(
      `Funcionalidad de anulación de nota de débito (ID: ${id}) no implementada completamente. Razón de anulación: ${reason}`,
    );
    throw new BadRequestError('accounts_payable.voiding_debit_notes_not_implemented_yet');
  }
}