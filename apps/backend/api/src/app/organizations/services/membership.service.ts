import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserOrganization } from '../entities/user-organization.entity';
import { Organization } from '../entities/organization.entity';

/** One tenant a person can act in, as the UI and the token both need it. */
export interface MembershipSummary {
  id: string;
  legalName: string;
  isActive: boolean;
}

/**
 * Who belongs to which tenant.
 *
 * `user_organizations` was created by migration, backfilled, and indexed twice — and then written
 * by nothing at all. One raw SQL query read it during authentication; no code path ever inserted a
 * row. So every membership in the system was whatever the backfill happened to capture on the day
 * it ran, and the multi-tenancy the table exists for could not actually happen: registering an
 * owner did not create a membership, and inviting a colleague did not either.
 *
 * This service is the only place memberships are written, so "which tenants may this person act
 * in" has exactly one answer and one implementation.
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
  ) {}

  /**
   * Record that a user may act in an organization. Idempotent.
   *
   * Takes an optional `EntityManager` so it participates in the transaction that created the user
   * — a membership written outside that transaction would survive a rollback and grant access to
   * a tenant whose owner was never created.
   */
  async grant(userId: string, organizationId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserOrganization) : this.membershipRepository;

    await repo
      .createQueryBuilder()
      .insert()
      .into(UserOrganization)
      .values({ userId, organizationId })
      .orIgnore()
      .execute();
  }

  /** Remove a membership. The caller decides policy; this only performs the removal. */
  async revoke(userId: string, organizationId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserOrganization) : this.membershipRepository;
    await repo.delete({ userId, organizationId });
  }

  async isMember(userId: string, organizationId: string): Promise<boolean> {
    return (await this.membershipRepository.countBy({ userId, organizationId })) > 0;
  }

  /**
   * Every tenant a person may act in, with the one they are currently in marked.
   *
   * The active organization is always included even when no membership row exists for it, and the
   * row is written when that happens. Without that, deploying this change would lock every user
   * created before memberships were written out of their own tenant. The backfill migration closes
   * the gap wholesale; this keeps the window safe and self-heals anything it missed.
   */
  async listFor(userId: string, activeOrganizationId?: string | null): Promise<MembershipSummary[]> {
    const rows = await this.organizationRepository
      .createQueryBuilder('o')
      .innerJoin(UserOrganization, 'uo', 'uo.organization_id = o.id')
      .where('uo.user_id = :userId', { userId })
      .select(['o.id AS id', 'o.legal_name AS "legalName"'])
      .orderBy('o.legal_name', 'ASC')
      .getRawMany<{ id: string; legalName: string }>();

    if (activeOrganizationId && !rows.some((row) => row.id === activeOrganizationId)) {
      const active = await this.organizationRepository.findOneBy({ id: activeOrganizationId });
      if (active) {
        this.logger.warn(
          { event: 'membership_row_missing', userId, organizationId: activeOrganizationId },
          'Active organization has no user_organizations row; including it and self-healing.',
        );
        await this.grant(userId, activeOrganizationId);
        rows.push({ id: active.id, legalName: active.legalName });
      }
    }

    return rows.map((row) => ({
      ...row,
      isActive: row.id === activeOrganizationId,
    }));
  }
}
