
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class UserCacheService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async clearUserSession(userId: string): Promise<void> {
    // We clear the session used by JwtStrategy
    await this.cacheManager.del(`user_session:${userId}`);
  }

  async getUser(userId: string): Promise<any | null> {
    return this.cacheManager.get(`user_session:${userId}`);
  }

  async setUser(userId: string, user: any, ttl?: number): Promise<void> {
    await this.cacheManager.set(`user_session:${userId}`, user, ttl);
  }

  /**
   * Invalidates the user cache explicitly.
   * Call this whenever critical user data (roles, status) changes.
   */
  async invalidate(userId: string): Promise<void> {
    return this.clearUserSession(userId);
  }

  /**
   * Invalidate the cached principal of every member of an organization.
   *
   * The principal carries the ORGANIZATION, including its `subscriptionStatus` and
   * `gracePeriodEnd` — and `SubscriptionActiveGuard` decides entitlement from that copy. Nothing
   * invalidated it when billing changed: `SaasService.clearOrganizationCache` only bumped the
   * limit-cache generation. So a customer who fixed their card stayed locked out for up to the
   * cache TTL, and a cancelled subscription kept working for just as long — in both directions,
   * on the one screen where the customer is trying to resolve the problem.
   *
   * Membership is read straight from `user_organizations` rather than through a service, because
   * this module is deliberately low-level and must not pull the organizations module in behind it.
   */
  async clearOrganizationMembers(organizationId: string): Promise<void> {
    const rows: Array<{ user_id: string }> = await this.dataSource.query(
      'SELECT user_id FROM user_organizations WHERE organization_id = $1',
      [organizationId],
    );

    await Promise.all(rows.map((row) => this.clearUserSession(row.user_id)));
  }

  async get<T>(key: string): Promise<T | null | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.cacheManager.set(key, value, ttlMs);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }
}
