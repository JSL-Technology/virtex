
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { BankTransfer } from './entities/bank-transfer.entity';
import { CreateBankTransferDto } from './dto/create-bank-transfer.dto';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError } from '../i18n/localized.exception';

@Injectable()
export class TreasuryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}

  async createBankTransfer(dto: CreateBankTransferDto, organizationId: string): Promise<BankTransfer> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (dto.fromAccountId === dto.toAccountId) {
        throw new BadRequestError('TREASURY.CUENTAS_ORIGEN_DESTINO_NO_PUEDEN_SER_MISMA');
      }
      
      const defaultLedger = await queryRunner.manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        throw new BadRequestError('TREASURY.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
      }

      const bankJournal = await queryRunner.manager.findOneBy(Journal, { organizationId, code: 'BANCOS' });
      if (!bankJournal) {
          throw new BadRequestError('TREASURY.DIARIO_BANCOS_BANCOS_NO_ENCONTRADO');
      }

      const transfer = queryRunner.manager.create(BankTransfer, {
        ...dto,
        organizationId,
      });
      const savedTransfer = await queryRunner.manager.save(transfer);
      
      const entryDto: CreateJournalEntryDto = {
        date: transfer.date.toISOString(),
        description: `Transferencia bancaria: ${transfer.description}`,
        journalId: bankJournal.id,
        lines: [
          { 
            accountId: transfer.toAccountId, 
            debit: transfer.amount, 
            credit: 0, 
            description: `Desde cta. ref #${transfer.reference}`,
            valuations: [{
              ledgerId: defaultLedger.id,
              debit: transfer.amount,
              credit: 0
            }]
          },
          { 
            accountId: transfer.fromAccountId, 
            debit: 0, 
            credit: transfer.amount, 
            description: `Hacia cta. ref #${transfer.reference}`,
            valuations: [{
              ledgerId: defaultLedger.id,
              debit: 0,
              credit: transfer.amount
            }]
          },
        ],
      };
      
      await this.journalEntriesService.createWithQueryRunner(queryRunner, entryDto, organizationId);

      await queryRunner.commitTransaction();
      return savedTransfer;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}