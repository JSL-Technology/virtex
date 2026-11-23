import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NotFoundError } from '../i18n/localized.exception';
import { Supplier } from './entities/supplier.entity';
import { SupplierBankAccount } from './entities/supplier-bank-account.entity';
import { CreateSupplierBankAccountDto, UpdateSupplierBankAccountDto } from './dto/supplier-bank-account.dto';

/**
 * A supplier's bank accounts (audit 2026-11-07, CMP-17).
 *
 * The number is encrypted at rest and never returned: reads carry the last four digits. Exactly
 * one account per supplier may be the default — marking another clears the previous one in the
 * same transaction, and `UQ_supplier_bank_accounts_default` makes two defaults impossible.
 */
@Injectable()
export class SupplierBankAccountsService {
  constructor(private readonly dataSource: DataSource) {}

  list(supplierId: string, organizationId: string): Promise<SupplierBankAccount[]> {
    return this.dataSource.getRepository(SupplierBankAccount).find({
      where: { supplierId, organizationId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  create(supplierId: string, dto: CreateSupplierBankAccountDto, organizationId: string): Promise<SupplierBankAccount> {
    return this.dataSource.transaction(async (manager) => {
      await this.requireSupplier(manager, supplierId, organizationId);
      const existing = await manager.count(SupplierBankAccount, { where: { supplierId, organizationId } });
      // The first account is the default whether or not it says so: a supplier with accounts and
      // no default could not be paid without asking which.
      const isDefault = dto.isDefault ?? existing === 0;
      if (isDefault) await this.clearDefault(manager, supplierId, organizationId);
      const number = normalizeAccountNumber(dto.accountNumber);
      const saved = await manager.save(
        manager.create(SupplierBankAccount, {
          organizationId,
          supplierId,
          bankName: dto.bankName.trim(),
          accountHolder: dto.accountHolder?.trim() || null,
          accountType: dto.accountType,
          accountNumber: number,
          accountLast4: number.slice(-4),
          currencyCode: dto.currencyCode ?? null,
          swift: dto.swift ?? null,
          iban: dto.iban ?? null,
          isDefault,
        }),
      );
      return this.withoutNumber(saved);
    });
  }

  update(
    supplierId: string,
    accountId: string,
    dto: UpdateSupplierBankAccountDto,
    organizationId: string,
  ): Promise<SupplierBankAccount> {
    return this.dataSource.transaction(async (manager) => {
      const account = await this.requireAccount(manager, supplierId, accountId, organizationId);
      if (dto.isDefault === true && !account.isDefault) await this.clearDefault(manager, supplierId, organizationId);
      const { accountNumber, ...rest } = dto;
      Object.assign(account, rest);
      if (accountNumber !== undefined) {
        account.accountNumber = normalizeAccountNumber(accountNumber);
        account.accountLast4 = account.accountNumber.slice(-4);
      }
      return this.withoutNumber(await manager.save(account));
    });
  }

  async remove(supplierId: string, accountId: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const account = await this.requireAccount(manager, supplierId, accountId, organizationId);
      await manager.delete(SupplierBankAccount, { id: account.id, organizationId });
    });
  }

  private async requireSupplier(manager: EntityManager, supplierId: string, organizationId: string): Promise<void> {
    const found = await manager.exists(Supplier, { where: { id: supplierId, organizationId } });
    if (!found) throw new NotFoundError('masters.supplier_bank.supplier_not_found');
  }

  private async requireAccount(
    manager: EntityManager,
    supplierId: string,
    accountId: string,
    organizationId: string,
  ): Promise<SupplierBankAccount> {
    const account = await manager.findOne(SupplierBankAccount, { where: { id: accountId, supplierId, organizationId } });
    if (!account) throw new NotFoundError('masters.supplier_bank.account_not_found');
    return account;
  }

  private async clearDefault(manager: EntityManager, supplierId: string, organizationId: string): Promise<void> {
    await manager.update(SupplierBankAccount, { supplierId, organizationId, isDefault: true }, { isDefault: false });
  }

  /** The saved entity still holds the number it was given; a response must not. */
  private withoutNumber(account: SupplierBankAccount): SupplierBankAccount {
    const copy = { ...account } as Partial<SupplierBankAccount>;
    delete copy.accountNumber;
    return copy as SupplierBankAccount;
  }
}

function normalizeAccountNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}
