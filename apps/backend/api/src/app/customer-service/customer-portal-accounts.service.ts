import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { CustomerPortalAccount } from './entities/customer-portal-account.entity';
import { assertTenantMember, assertTenantOwns } from '../shared/tenancy/tenant-ownership';
import { ConflictError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';

/**
 * Which customer a portal user is (CS-01). The portal reads only what belongs to that customer,
 * and a user with no live binding reads nothing — however their role was configured.
 */
@Injectable()
export class CustomerPortalAccountsService {
  constructor(private readonly dataSource: DataSource) {}

  /** The customer the user is bound to; refuses when there is none. */
  async requireCustomer(organizationId: string, userId: string, manager: EntityManager = this.dataSource.manager): Promise<string> {
    const account = await manager.findOne(CustomerPortalAccount, {
      where: { organizationId, userId, revokedAt: IsNull() },
      select: ['id', 'customerId'],
    });
    if (!account) throw new ForbiddenError('customer_service.portal_no_customer_identity');
    return account.customerId;
  }

  list(organizationId: string, customerId?: string): Promise<CustomerPortalAccount[]> {
    return this.dataSource.manager.find(CustomerPortalAccount, {
      where: { organizationId, revokedAt: IsNull(), ...(customerId ? { customerId } : {}) },
      order: { grantedAt: 'DESC' },
    });
  }

  /**
   * Bind a member of the tenant to one of its customers. A user is one customer at a time: binding
   * them to another needs the current binding revoked first, so nobody is moved between customers'
   * documents by accident.
   */
  grant(
    organizationId: string,
    input: { userId: string; customerId: string },
    actorUserId: string,
  ): Promise<CustomerPortalAccount> {
    return this.dataSource.transaction(async (manager) => {
      await assertTenantMember(manager, input.userId, organizationId, { field: 'userId' });
      await assertTenantOwns(manager, 'customers', [input.customerId], organizationId, {
        errorKey: 'customer_service.portal_customer_not_found',
        field: 'customerId',
      });
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `customer-portal-account:${organizationId}:${input.userId}`,
      ]);
      const live = await manager.findOne(CustomerPortalAccount, {
        where: { organizationId, userId: input.userId, revokedAt: IsNull() },
      });
      if (live) {
        if (live.customerId === input.customerId) return live;
        throw new ConflictError('customer_service.portal_user_bound_to_other_customer');
      }
      return manager.save(
        manager.create(CustomerPortalAccount, {
          organizationId,
          userId: input.userId,
          customerId: input.customerId,
          grantedByUserId: actorUserId,
          revokedAt: null,
          revokedByUserId: null,
        }),
      );
    });
  }

  async revoke(organizationId: string, accountId: string, actorUserId: string): Promise<CustomerPortalAccount> {
    const account = await this.dataSource.manager.findOne(CustomerPortalAccount, {
      where: { id: accountId, organizationId, revokedAt: IsNull() },
    });
    if (!account) throw new NotFoundError('customer_service.portal_account_not_found');
    account.revokedAt = new Date();
    account.revokedByUserId = actorUserId;
    return this.dataSource.manager.save(account);
  }
}
