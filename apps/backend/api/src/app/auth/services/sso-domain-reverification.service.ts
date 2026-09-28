import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { promises as dns } from 'dns';
import { OrganizationDomain } from '../../organizations/entities/organization-domain.entity';
import { IdentityProvider } from '../entities/identity-provider.entity';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';

/** DNS host (relative to the domain) where the verification TXT record lives. */
const DNS_VERIFICATION_PREFIX = '_virteex-sso';

/**
 * Consecutive daily checks that must fail before a domain loses its verification. A record can
 * disappear for a few hours during a DNS migration; a domain that changed hands does not get it
 * back.
 */
export const DOMAIN_REVERIFY_FAILURE_THRESHOLD = 3;

/** DNS answers that mean "the record is not there", as opposed to "DNS did not answer". */
const ABSENT = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

export type RecheckOutcome = 'present' | 'absent' | 'unknown';

/**
 * Re-verifies SSO domains against DNS, every day.
 *
 * A domain was verified once and trusted forever. Domains lapse and change hands; when they do,
 * the organization that once proved control keeps routing — and JIT-provisioning — every address
 * at that domain into its own tenant. Now each verified claim is checked daily: the record found
 * resets the count, the record absent increments it, and after
 * `DOMAIN_REVERIFY_FAILURE_THRESHOLD` consecutive absences the claim is unverified. An
 * organization left with no verified domain has its IdPs disabled, since enabling one requires a
 * verified domain in the first place.
 *
 * A DNS failure that is not an answer (a timeout, a server failure) counts for nothing either
 * way: an outage of the resolver must not strip every customer of SSO.
 */
@Injectable()
export class SsoDomainReverificationService {
  private readonly logger = new Logger(SsoDomainReverificationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OrganizationDomain)
    private readonly domains: Repository<OrganizationDomain>,
    @InjectRepository(IdentityProvider)
    private readonly idps: Repository<IdentityProvider>,
    private readonly schedulerLock: SchedulerLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'sso-domain-reverification' })
  async runDaily(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await this.schedulerLock.runOnce('sso-domain-reverification', day, () => this.recheckAll());
  }

  /** Re-check every verified claim. Visible across tenants through the `sso_routing` policy. */
  async recheckAll(): Promise<void> {
    // tenant-scope-guard-allow: a platform job over every VERIFIED claim (`sso_routing`); each
    // write below happens in the claim's own tenant.
    const verified = await this.domains.find({ where: { verified: true } });
    for (const claim of verified) {
      try {
        await this.recheck(claim);
      } catch (error) {
        this.logger.error(
          { event: 'sso_domain_recheck_failed', domain: claim.domain, error: (error as Error).message },
          'Could not re-check an SSO domain',
        );
      }
    }
  }

  async recheck(claim: OrganizationDomain): Promise<RecheckOutcome> {
    const outcome = await this.lookup(claim);
    if (outcome === 'unknown') return outcome;

    await runAsTenantJob(this.dataSource, claim.organizationId, async () => {
      if (outcome === 'present') {
        await this.domains.update(
          { id: claim.id, organizationId: claim.organizationId },
          { lastCheckedAt: new Date(), failedChecks: 0 },
        );
        return;
      }

      const failedChecks = (claim.failedChecks ?? 0) + 1;
      if (failedChecks < DOMAIN_REVERIFY_FAILURE_THRESHOLD) {
        await this.domains.update(
          { id: claim.id, organizationId: claim.organizationId },
          { lastCheckedAt: new Date(), failedChecks },
        );
        this.logger.warn(
          { event: 'sso_domain_record_missing', domain: claim.domain, failedChecks },
          'SSO domain verification record not found',
        );
        return;
      }

      await this.domains.update(
        { id: claim.id, organizationId: claim.organizationId },
        { lastCheckedAt: new Date(), failedChecks, verified: false, verifiedAt: null },
      );
      this.logger.warn(
        { event: 'sso_domain_unverified', domain: claim.domain, organizationId: claim.organizationId },
        '[SECURITY] SSO domain lost its verification: the DNS record has been gone for several days',
      );

      const stillVerified = await this.domains.count({
        where: { organizationId: claim.organizationId, verified: true },
      });
      if (stillVerified === 0) {
        const disabled = await this.idps.update(
          { organizationId: claim.organizationId, enabled: true },
          { enabled: false },
        );
        if (disabled.affected) {
          this.logger.warn(
            { event: 'sso_idps_disabled_no_verified_domain', organizationId: claim.organizationId },
            '[SECURITY] Enterprise SSO disabled: the organization has no verified domain left',
          );
        }
      }
    });
    return outcome;
  }

  private async lookup(claim: OrganizationDomain): Promise<RecheckOutcome> {
    const host = `${DNS_VERIFICATION_PREFIX}.${claim.domain}`;
    try {
      const records = await dns.resolveTxt(host);
      const found = records
        .map((chunks) => chunks.join('').trim())
        .some((value) => value === claim.verificationToken);
      return found ? 'present' : 'absent';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      return ABSENT.has(code) ? 'absent' : 'unknown';
    }
  }
}
