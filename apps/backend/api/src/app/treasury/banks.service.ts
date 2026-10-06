import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Bank } from './entities/bank.entity';
import { BankAccount } from './entities/bank-account.entity';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';

/** A catalogue bank, with how many of the tenant's bank accounts are held there. */
export interface BankWithUsage extends Bank {
  accountCount: number;
}

/**
 * The tenant's bank catalogue: the institutions, kept once and referenced by bank accounts.
 *
 * Deleting a bank an account still points at is refused rather than cascaded or nulled: the
 * account would silently lose its institution. Deactivating is how a bank leaves the pickers.
 */
@Injectable()
export class BanksService {
  constructor(
    @InjectRepository(Bank) private readonly banks: Repository<Bank>,
    @InjectRepository(BankAccount) private readonly accounts: Repository<BankAccount>,
  ) {}

  async findAll(organizationId: string): Promise<BankWithUsage[]> {
    const [list, counts] = await Promise.all([
      this.banks.find({ where: { organizationId }, order: { name: 'ASC' } }),
      this.accounts
        .createQueryBuilder('account')
        .select('account.bankId', 'bankId')
        .addSelect('COUNT(account.id)', 'count')
        .where('account.organizationId = :organizationId', { organizationId })
        .andWhere('account.bankId IS NOT NULL')
        .groupBy('account.bankId')
        .getRawMany<{ bankId: string; count: string }>(),
    ]);
    const byBank = new Map(counts.map((row) => [row.bankId, Number(row.count)]));
    return list.map((bank) => Object.assign(bank, { accountCount: byBank.get(bank.id) ?? 0 }));
  }

  async findOne(id: string, organizationId: string): Promise<Bank> {
    const bank = await this.banks.findOne({ where: { id, organizationId } });
    if (!bank) throw new NotFoundError('treasury.bank_not_found');
    return bank;
  }

  async create(dto: CreateBankDto, organizationId: string): Promise<Bank> {
    const name = dto.name.trim();
    await this.assertNameFree(organizationId, name);
    return this.banks.save(
      this.banks.create({
        organizationId,
        name,
        swiftBic: normalizeBic(dto.swiftBic),
        countryCode: dto.countryCode?.toUpperCase() ?? null,
        localCode: dto.localCode?.trim() || null,
        isActive: true,
      }),
    );
  }

  /**
   * Edits the catalogue entry and carries its name and BIC onto the accounts held there, in one
   * transaction: the copies on the accounts exist for statement matching, and a copy that drifts
   * from its source would match against a name the bank no longer uses.
   */
  async update(id: string, dto: UpdateBankDto, organizationId: string): Promise<Bank> {
    return this.banks.manager.transaction(async (manager) => {
      const bank = await manager.findOne(Bank, { where: { id, organizationId } });
      if (!bank) throw new NotFoundError('treasury.bank_not_found');

      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (name !== bank.name) await this.assertNameFree(organizationId, name, manager);
        bank.name = name;
      }
      if (dto.swiftBic !== undefined) bank.swiftBic = normalizeBic(dto.swiftBic);
      if (dto.countryCode !== undefined) bank.countryCode = dto.countryCode ? dto.countryCode.toUpperCase() : null;
      if (dto.localCode !== undefined) bank.localCode = dto.localCode?.trim() || null;
      if (dto.isActive !== undefined) bank.isActive = dto.isActive;

      const saved = await manager.save(bank);
      await manager.update(
        BankAccount,
        { organizationId, bankId: bank.id },
        { bankName: saved.name, swiftBic: saved.swiftBic },
      );
      return saved;
    });
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const bank = await this.findOne(id, organizationId);
    const inUse = await this.accounts.count({ where: { organizationId, bankId: bank.id } });
    if (inUse > 0) {
      throw new ConflictError('treasury.bank_in_use', { count: inUse });
    }
    await this.banks.delete({ id: bank.id, organizationId });
  }

  /**
   * The catalogue bank a bank account is being linked to, checked for the tenant and for being in
   * use. `null` unlinks.
   */
  async resolveForAccount(
    manager: EntityManager,
    bankId: string | null | undefined,
    organizationId: string,
  ): Promise<Bank | null | undefined> {
    if (bankId === undefined) return undefined;
    if (bankId === null) return null;
    const bank = await manager.findOne(Bank, { where: { id: bankId, organizationId } });
    if (!bank) throw new BadRequestError('treasury.bank_not_found');
    if (!bank.isActive) throw new BadRequestError('treasury.bank_inactive');
    return bank;
  }

  private async assertNameFree(organizationId: string, name: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(Bank) : this.banks;
    const existing = await repo
      .createQueryBuilder('bank')
      .where('bank.organizationId = :organizationId', { organizationId })
      .andWhere('lower(bank.name) = lower(:name)', { name })
      .getOne();
    if (existing) throw new ConflictError('treasury.bank_name_taken', { name });
  }
}

function normalizeBic(value: string | undefined | null): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}
