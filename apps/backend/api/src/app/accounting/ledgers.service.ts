
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Between } from 'typeorm';
import { Ledger } from './entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { GeneralLedger } from '../core/models/general-ledger.model';
import { AccountNature } from '../chart-of-accounts/enums/account-enums';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { CreateLedgerDto, UpdateLedgerDto } from './dto/ledger.dto';

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
      throw new NotFoundError('ACCOUNTING.CUENTA_ID_NO_ENCONTRADA', { accountId });
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
      throw new NotFoundError('ACCOUNTING.LIBRO_CONTABLE_ID_NO_ENCONTRADO', { id });
    }
    return ledger;
  }

  async create(createDto: CreateLedgerDto, organizationId: string): Promise<Ledger> {
    if (createDto.isDefault) {
      await this.ensureNoOtherDefault(organizationId);
    }
    const ledger = this.ledgerRepository.create({
      // Field by field. `{ ...createDto, organizationId }` was safe only because the tenant came
      // last; one reordering away from letting the body choose its own tenant.
      name: createDto.name,
      description: createDto.description,
      currency: createDto.currency.toUpperCase(),
      isDefault: createDto.isDefault ?? false,
      isActive: createDto.isActive ?? true,
      organizationId,
    });
    return this.ledgerRepository.save(ledger);
  }

  /**
   * Update the fields a ledger may have changed.
   *
   * Assignment is explicit. `Object.assign(ledger, updateDto)` over a body the ValidationPipe never
   * inspected — because `Partial<Ledger>` leaves `Object` as the runtime metatype — let a request
   * carrying `organizationId` move the ledger, and the accounting hanging off it, to another
   * tenant. Neither the tenant nor the id is assignable here, whatever the body says.
   */
  async update(
    id: string,
    updateDto: UpdateLedgerDto,
    organizationId: string,
  ): Promise<Ledger> {
    const ledger = await this.findOne(id, organizationId);

    if (updateDto.isDefault && !ledger.isDefault) {
      await this.ensureNoOtherDefault(organizationId);
    }
    if (updateDto.isDefault === false && ledger.isDefault) {
      // A tenant with no default ledger cannot post at all: every posting path resolves the
      // default to value its lines against.
      throw new BadRequestError('ACCOUNTING.LIBRO_DEFECTO_NO_PUEDE_QUEDAR_SIN_ASIGNAR');
    }

    if (updateDto.name !== undefined) ledger.name = updateDto.name;
    if (updateDto.description !== undefined) ledger.description = updateDto.description;
    if (updateDto.isDefault !== undefined) ledger.isDefault = updateDto.isDefault;
    if (updateDto.isActive !== undefined) ledger.isActive = updateDto.isActive;

    return this.ledgerRepository.save(ledger);
  }

  private async ensureNoOtherDefault(organizationId: string): Promise<void> {
    await this.ledgerRepository.update({ organizationId, isDefault: true }, { isDefault: false });
  }
}