import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Bank } from './entities/bank.entity';
import { BankAccount } from './entities/bank-account.entity';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { organizationMarket } from '../organizations/contracts/market.contract';
import { referenceBanksFor, retiredBic, type ReferenceBank } from './reference';

/** A catalogue bank, with how many of the tenant's bank accounts are held there. */
export interface BankWithUsage extends Bank {
  accountCount: number;
}

/** What the official list for the company's country would add to its catalogue. */
export interface ReferenceBanksStatus {
  /** The company's country, or null when it has not stated one. */
  country: string | null;
  /** How many institutions the official list for that country holds (0: no list shipped). */
  available: number;
  /** How many of them the catalogue does not have yet. */
  missing: number;
}

export interface ReferenceBanksImport {
  country: string | null;
  added: number;
  /** Already in the catalogue, under its name, legal name, BIC or taxpayer number. */
  skipped: number;
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
    const swiftBic = normalizeBic(dto.swiftBic);
    assertBicInUse(swiftBic);
    await this.assertNameFree(organizationId, name);
    return this.banks.save(
      this.banks.create({
        organizationId,
        name,
        legalName: dto.legalName?.trim() || null,
        taxId: dto.taxId?.trim() || null,
        kind: dto.kind ?? null,
        swiftBic,
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
      if (dto.swiftBic !== undefined) {
        const swiftBic = normalizeBic(dto.swiftBic);
        // Only a BIC being changed is checked: a bank already carrying a retired one can still be
        // renamed or deactivated, which is how it is put right.
        if (swiftBic !== bank.swiftBic) assertBicInUse(swiftBic);
        bank.swiftBic = swiftBic;
      }
      if (dto.legalName !== undefined) bank.legalName = dto.legalName?.trim() || null;
      if (dto.taxId !== undefined) bank.taxId = dto.taxId?.trim() || null;
      if (dto.kind !== undefined) bank.kind = dto.kind ?? null;
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

  /** Whether the official list for the company's country has institutions its catalogue lacks. */
  async referenceStatus(organizationId: string): Promise<ReferenceBanksStatus> {
    const { country, reference, existing } = await this.referenceContext(organizationId);
    const missing = reference.filter((entry) => !existing.has(entry)).length;
    return { country, available: reference.length, missing };
  }

  /**
   * Adds to the catalogue the institutions of the official list for the company's country that it
   * does not have yet.
   *
   * Idempotent and additive: an institution already there — matched by its name, its legal name,
   * its BIC or its taxpayer number, whatever it is called in this catalogue — is left exactly as
   * the company keeps it, never overwritten. Running it again after the list grows adds only what
   * is new. Two imports racing each other cannot duplicate a bank: the per-tenant unique name
   * turns the second insert of one into a no-op.
   */
  async importReference(organizationId: string): Promise<ReferenceBanksImport> {
    const { country, reference, existing } = await this.referenceContext(organizationId);
    const toAdd = reference.filter((entry) => !existing.has(entry));
    if (toAdd.length === 0) return { country, added: 0, skipped: reference.length };

    const result = await this.banks
      .createQueryBuilder()
      .insert()
      .into(Bank)
      .values(
        toAdd.map((entry) => ({
          organizationId,
          name: entry.name,
          legalName: entry.legalName,
          taxId: entry.taxId,
          kind: entry.kind,
          swiftBic: entry.swiftBic,
          countryCode: country,
          localCode: entry.localCode,
          isActive: true,
        })),
      )
      .orIgnore()
      .returning(['id'])
      .execute();
    const added = Array.isArray(result.raw) ? result.raw.length : 0;
    return { country, added, skipped: reference.length - added };
  }

  private async referenceContext(organizationId: string) {
    const { country } = await organizationMarket(this.banks.manager, organizationId);
    const reference = referenceBanksFor(country);
    const banks = reference.length
      ? await this.banks.find({
          where: { organizationId },
          select: ['id', 'name', 'legalName', 'swiftBic', 'taxId'],
        })
      : [];
    return { country, reference, existing: new CatalogueIndex(banks) };
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

/** Refuses a BIC that no longer identifies an institution, naming its successor when there is one. */
function assertBicInUse(bic: string | null): void {
  const retired = retiredBic(bic);
  if (!retired) return;
  if (retired.successor) {
    throw new BadRequestError('treasury.bank_bic_replaced', {
      bic: retired.bic,
      institution: retired.institution,
      successor: retired.successor,
    });
  }
  throw new BadRequestError('treasury.bank_bic_retired', { bic: retired.bic, institution: retired.institution });
}

/**
 * The ways a catalogue may already know an institution. A company that typed «Popular» by hand,
 * or the legal name, or only the BIC, already has it: the import adds nothing beside it.
 */
class CatalogueIndex {
  private readonly names = new Set<string>();
  private readonly bics = new Set<string>();
  private readonly taxIds = new Set<string>();

  constructor(banks: Pick<Bank, 'name' | 'legalName' | 'swiftBic' | 'taxId'>[]) {
    for (const bank of banks) {
      this.names.add(nameKey(bank.name));
      if (bank.legalName) this.names.add(nameKey(bank.legalName));
      if (bank.swiftBic) this.bics.add(bank.swiftBic.slice(0, 8).toUpperCase());
      const taxId = digits(bank.taxId);
      if (taxId) this.taxIds.add(taxId);
    }
  }

  has(entry: ReferenceBank): boolean {
    if (this.names.has(nameKey(entry.name)) || this.names.has(nameKey(entry.legalName))) return true;
    if (entry.swiftBic && this.bics.has(entry.swiftBic.slice(0, 8))) return true;
    const taxId = digits(entry.taxId);
    return !!taxId && this.taxIds.has(taxId);
  }
}

/** Case, accents, punctuation and spacing aside: «Banco Múltiple BHD, S. A.» = «BANCO MULTIPLE BHD SA». */
function nameKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function digits(value: string | null | undefined): string | null {
  const only = value?.replace(/\D/g, '');
  return only ? only : null;
}

function normalizeBic(value: string | undefined | null): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}
