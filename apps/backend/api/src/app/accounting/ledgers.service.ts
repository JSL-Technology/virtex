
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Between } from 'typeorm';
import { Ledger } from './entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { GeneralLedger } from '../core/models/general-ledger.model';
import { AccountNature } from '../chart-of-accounts/enums/account-enums';

@Injectable()
export class LedgersService {
  constructor(
    @InjectRepository(Ledger)
    private readonly ledgerRepository: Repository<Ledger>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
  ) {}

  async getGeneralLedger(
    organizationId: string,
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<GeneralLedger> {
    const account = await this.accountRepository.findOne({ where: { id: accountId, organizationId } });
    if (!account) {
      throw new NotFoundException(`Cuenta con ID "${accountId}" no encontrada.`);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);


    const priorLines = await this.journalEntryLineRepository.find({
      where: {
        accountId,
        journalEntry: {
          date: LessThan(start),
          organizationId,
        },
      },
    });

    let initialBalance = 0;
    priorLines.forEach(line => {
      if (account.nature === AccountNature.DEBIT) {
        initialBalance += line.debit - line.credit;
      } else {
        initialBalance += line.credit - line.debit;
      }
    });



    const periodLines = await this.journalEntryLineRepository.find({
      where: {
        accountId,
        journalEntry: {
          date: Between(start, end),
          organizationId,
        },
      },
      relations: ['journalEntry'],
      order: {
        journalEntry: {
          date: 'ASC',
        },
      },
    });


    let currentBalance = initialBalance;
    const ledgerLines = periodLines.map(line => {
      const balanceImpact = line.debit - line.credit;
      currentBalance += account.nature === AccountNature.DEBIT ? balanceImpact : -balanceImpact;
      return {
        id: line.id,
        date: line.journalEntry.date,
        reference: `JE-${line.journalEntry.id.substring(0, 8)}`,
        description: line.description || line.journalEntry.description,
        debit: line.debit,
        credit: line.credit,
        balance: currentBalance,
      };
    });

    const finalBalance = currentBalance;

    return {

      account: { code: account.code, name: account.name['es'] || 'Nombre no disponible' },
      startDate,
      endDate,
      initialBalance,
      finalBalance,
      lines: ledgerLines,
    };
  }

  findAll(organizationId: string): Promise<Ledger[]> {
    return this.ledgerRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<Ledger> {
    const ledger = await this.ledgerRepository.findOne({ where: { id, organizationId } });
    if (!ledger) {
      throw new NotFoundException(`Libro contable con ID "${id}" no encontrado.`);
    }
    return ledger;
  }

  async create(createDto: Partial<Ledger>, organizationId: string): Promise<Ledger> {
    if (createDto.isDefault) {
      await this.ensureNoOtherDefault(organizationId);
    }
    const ledger = this.ledgerRepository.create({ ...createDto, organizationId });
    return this.ledgerRepository.save(ledger);
  }

  async update(id: string, updateDto: Partial<Ledger>, organizationId: string): Promise<Ledger> {
    const ledger = await this.findOne(id, organizationId);
    if (updateDto.isDefault && !ledger.isDefault) {
      await this.ensureNoOtherDefault(organizationId);
    }
    Object.assign(ledger, updateDto);
    return this.ledgerRepository.save(ledger);
  }

  private async ensureNoOtherDefault(organizationId: string): Promise<void> {
    await this.ledgerRepository.update({ organizationId, isDefault: true }, { isDefault: false });
  }
}