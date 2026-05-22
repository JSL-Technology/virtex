
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
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
        throw new NotFoundException(
          'La factura del proveedor no fue encontrada.',
        );
      }
      if (vendorBill.status !== VendorBillStatus.OPEN && vendorBill.status !== VendorBillStatus.PARTIALLY_PAID) {
          throw new BadRequestException('Solo se pueden aplicar notas de débito a facturas abiertas o parcialmente pagadas.');
      }
      if (vendorBill.balance < amount) {
        throw new BadRequestException(
          'El monto de la nota de débito no puede ser mayor al saldo de la factura.',
        );
      }

      const settings = await manager.findOneBy(OrganizationSettings, {
        organizationId,
      });
      if (!settings || !settings.defaultAccountsPayableId) {
        throw new BadRequestException(
          'La cuenta por pagar por defecto no está configurada.',
        );
      }

      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
      }

      const journal = await manager.findOneBy(Journal, { organizationId, code: 'COMPRAS' });
      if (!journal) {
          throw new BadRequestException('Diario de Compras (COMPRAS) no encontrado para registrar la nota de débito.');
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
        throw new InternalServerErrorException('No se pudo obtener el Query Runner de la transacción.');
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
      throw new NotFoundException(`Nota de débito con ID "${id}" no encontrada.`);
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
      throw new NotFoundException(`Nota de débito con ID "${id}" no encontrada.`);
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
    throw new BadRequestException('La funcionalidad de anulación de notas de débito aún no está implementada.');
  }
}