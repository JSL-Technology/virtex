import { EntityManager } from 'typeorm';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { BadRequestError } from '../i18n/localized.exception';

/** The account exists in this company, is active and takes postings. */
export async function assertPostableAccount(manager: EntityManager, organizationId: string, accountId: string): Promise<void> {
  const account = await manager.findOne(Account, { where: { id: accountId, organizationId } });
  if (!account) throw new BadRequestError('fixed_assets.account_not_found');
  if (!account.isActive || !account.isPostable) {
    throw new BadRequestError('fixed_assets.account_not_postable', { code: account.code, name: account.name });
  }
}
