import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { UserOrganization } from '../entities/user-organization.entity';
import { Organization } from '../entities/organization.entity';
import { UserCacheService } from '../../auth/modules/user-cache.service';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';

/** One tenant a person can act in, as the UI and the token both need it. */
export interface MembershipSummary {
  id: string;
  legalName: string;
  /** El identificador de la empresa en la URL; el cliente construye los enlaces con él. */
  slug: string;
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
    private readonly userCacheService: UserCacheService,
    private readonly dataSource: DataSource,
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

  /**
   * Remove a membership, and make the removal take effect immediately.
   *
   * Deleting the row is not sufficient on its own. `resolveOrganizationContext` validates the
   * tenant against `user.organizations` from the CACHED projection, which lives for fifteen
   * minutes, so a revoked membership kept working until that entry expired. Today the only
   * caller — `UsersService.remove` — also clears the cache and ends the user's sessions, so the
   * window was closed by luck rather than by design; a second caller would have reopened it.
   *
   * The caller still decides policy. This makes the removal true.
   */
  async revoke(userId: string, organizationId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserOrganization) : this.membershipRepository;
    await repo.delete({ userId, organizationId });
    await this.userCacheService.clearUserSession(userId);
  }

  /**
   * Whether the person may act in the tenant: a membership exists AND the tenant has not suspended
   * it. A suspended membership is a membership in the administration screen and nowhere else.
   */
  async isMember(userId: string, organizationId: string): Promise<boolean> {
    return (
      (await this.membershipRepository.countBy({ userId, organizationId, suspendedAt: IsNull() })) > 0
    );
  }

  /** Whether a membership row exists at all, suspended or not. */
  async hasMembershipRow(userId: string, organizationId: string): Promise<boolean> {
    return (await this.membershipRepository.countBy({ userId, organizationId })) > 0;
  }

  /**
   * Stop a person acting in ONE tenant, without touching their account.
   *
   * The tenant-local counterpart of blocking. A tenant that is not the person's home organization
   * has no authority over the identity — blocking the account would cut them off from every other
   * tenant too — but it has full authority over access to itself, and this is that authority.
   * The cached principal is dropped so the suspension applies to the very next request.
   */
  async suspend(userId: string, organizationId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserOrganization) : this.membershipRepository;
    await repo.update({ userId, organizationId }, { suspendedAt: new Date() });
    await this.userCacheService.clearUserSession(userId);
  }

  /** Lift a tenant-local suspension. */
  async reinstate(userId: string, organizationId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserOrganization) : this.membershipRepository;
    await repo.update({ userId, organizationId }, { suspendedAt: null });
    await this.userCacheService.clearUserSession(userId);
  }

  /** Whether this tenant has suspended the person. False when there is no membership at all. */
  async isSuspended(userId: string, organizationId: string): Promise<boolean> {
    const row = await this.membershipRepository.findOne({
      where: { userId, organizationId },
      select: ['userId', 'suspendedAt'],
    });
    return Boolean(row?.suspendedAt);
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
      // A suspended membership grants nothing. This list is what `resolveOrganizationContext`
      // authorises a tenant switch against, so leaving it out here is what enforces it.
      .andWhere('uo.suspended_at IS NULL')
      .select(['o.id AS id', 'o.legal_name AS "legalName"', 'o.slug AS slug'])
      .orderBy('o.legal_name', 'ASC')
      .getRawMany<{ id: string; legalName: string; slug: string }>();

    if (
      activeOrganizationId &&
      !rows.some((row) => row.id === activeOrganizationId) &&
      // Self-heal only a MISSING row. A row that exists but is suspended is a decision, and
      // re-adding it here would silently undo it.
      !(await this.hasMembershipRow(userId, activeOrganizationId))
    ) {
      const active = await this.organizationRepository.findOneBy({ id: activeOrganizationId });
      if (active) {
        this.logger.warn(
          { event: 'membership_row_missing', userId, organizationId: activeOrganizationId },
          'Active organization has no user_organizations row; including it and self-healing.',
        );
        // Con el contexto de la empresa a la que pertenece la fila.
        //
        // `user_organizations` tiene política de aislamiento, y este remiendo se ejecuta durante
        // el INICIO DE SESIÓN, que por definición no tiene inquilino todavía: la autenticación
        // ocurre antes de que haya una empresa a la que pertenecer. Sin contexto, `WITH CHECK`
        // rechaza el INSERT y —como esto está en el camino del login— tumbaba el login entero con
        // un 500. La fila es de esta empresa, así que se escribe como ella.
        await runAsTenantJob(this.dataSource, activeOrganizationId, () =>
          this.grant(userId, activeOrganizationId),
        );
        rows.push({ id: active.id, legalName: active.legalName, slug: active.slug });
      }
    }

    return rows.map((row) => ({
      ...row,
      isActive: row.id === activeOrganizationId,
    }));
  }
}
