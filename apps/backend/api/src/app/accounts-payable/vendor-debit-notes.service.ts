
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

@Injectable()
export class VendorDebitNotesService {
  private readonly logger = new Logger(VendorDebitNotesService.name);

  constructor(
    @InjectRepository(VendorDebitNote)
    private vendorDebitNoteRepository: Repository<VendorDebitNote>,
    private dataSource: DataSource,
    private journalEntriesService: JournalEntriesService,
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
        throw new NotFoundError('ACCOUNTS_PAYABLE.FACTURA_PROVEEDOR_NO_FUE_ENCONTRADA');
      }
      if (vendorBill.status !== VendorBillStatus.OPEN && vendorBill.status !== VendorBillStatus.PARTIALLY_PAID) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.SOLO_PUEDEN_APLICAR_NOTAS_DEBITO_FACTURAS_ABIERTAS');
      }
      if (vendorBill.balance < amount) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.MONTO_NOTA_DEBITO_NO_PUEDE_SER_MAYOR');
      }

      const settings = await manager.findOneBy(OrganizationSettings, {
        organizationId,
      });
      if (!settings || !settings.defaultAccountsPayableId) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_PAGAR_DEFECTO_NO_ESTA_CONFIGURADA');
      }

      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
      }

      const journal = await manager.findOneBy(Journal, { organizationId, code: 'COMPRAS' });
      if (!journal) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.DIARIO_COMPRAS_COMPRAS_NO_ENCONTRADO_REGISTRAR_NOTA');
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
        throw new InternalServerError('ACCOUNTS_PAYABLE.NO_PUDO_OBTENER_QUERY_RUNNER_TRANSACCION');
      }

      const entryDto: CreateJournalEntryDto = {
          date: new Date().toISOString(),
          description: `Nota de Débito para factura de prov. Razón: ${reason}`,
          journalId: journal.id,
          lines: [
            {
              accountId: settings.defaultAccountsPayableId,
              debit: amount,
              credit: 0,
              description: `ND a factura prov. #${vendorBill.id.substring(0, 8)}`,
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
              description: `Contrapartida ND. Razón: ${reason}`,
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
      throw new NotFoundError('ACCOUNTS_PAYABLE.NOTA_DEBITO_ID_NO_ENCONTRADA', { id });
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
      throw new NotFoundError('ACCOUNTS_PAYABLE.NOTA_DEBITO_ID_NO_ENCONTRADA', { id });
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
    throw new BadRequestError('ACCOUNTS_PAYABLE.FUNCIONALIDAD_ANULACION_NOTAS_DEBITO_AUN_NO_ESTA');
  }
}