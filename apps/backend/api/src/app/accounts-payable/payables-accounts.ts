import { EntityManager } from 'typeorm';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountRole } from '../chart-of-accounts/enums/account-enums';
import { BadRequestError } from '../i18n/localized.exception';

/**
 * An account by its operational role, falling back to the legacy settings column.
 *
 * One place for every payables document — bill, payment, debit note — so they all resolve "the
 * input tax account" the same way and a tenant that tags its chart by role gets the same answer
 * from each of them.
 */
export async function resolveAccountByRole(
  manager: EntityManager,
  organizationId: string,
  role: AccountRole,
  fallbackId: string | null | undefined,
): Promise<string | null> {
  const account = await manager.findOne(Account, { where: { organizationId, systemRole: role } });
  return account?.id ?? fallbackId ?? null;
}

/** Deductible tax paid on purchases: what a debit note gives back when it returns taxed goods. */
export function resolvePurchaseTaxAccount(
  manager: EntityManager,
  organizationId: string,
  fallbackId: string | null | undefined,
): Promise<string | null> {
  return resolveAccountByRole(manager, organizationId, AccountRole.TAX_RECEIVABLE, fallbackId);
}

/**
 * The account a caller named exists in this company, is active and takes postings — a header
 * account cannot carry a line, and an account from another company must not be named at all.
 */
export async function assertPostableAccount(
  manager: EntityManager,
  organizationId: string,
  accountId: string,
): Promise<void> {
  const account = await manager.findOne(Account, { where: { id: accountId, organizationId } });
  if (!account) throw new BadRequestError('accounts_payable.account_not_found');
  if (!account.isActive || !account.isPostable) {
    throw new BadRequestError('accounts_payable.account_not_postable', { code: account.code, name: account.name });
  }
}
