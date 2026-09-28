import { DataSource } from 'typeorm';
import { promises as dns } from 'dns';
import { ConflictException } from '@nestjs/common';
import { Organization } from '../../organizations/entities/organization.entity';
import { OrganizationDomain } from '../../organizations/entities/organization-domain.entity';
import { IdentityProvider } from '../entities/identity-provider.entity';
import { SsoAdminService, PENDING_DOMAIN_CLAIM_TTL_MS } from './sso-admin.service';
import {
  DOMAIN_REVERIFY_FAILURE_THRESHOLD,
  SsoDomainReverificationService,
} from './sso-domain-reverification.service';

/**
 * SSO domain claims, against Postgres: the uniqueness that matters is enforced by a partial index,
 * and a race between two organizations is settled by it, which a mock cannot show.
 *
 *  - An unproven claim blocks nobody and tells nobody anything.
 *  - A pending claim expires.
 *  - The first organization to prove DNS control wins; the second is told.
 *  - A verified claim whose record disappears lapses after a few days, and SSO goes with it.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('SSO domain claims', () => {
  jest.setTimeout(120_000);

  let ds: DataSource;
  let admin: SsoAdminService;
  let reverify: SsoDomainReverificationService;
  let orgA: Organization;
  let orgB: Organization;
  const txt = jest.spyOn(dns, 'resolveTxt');

  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const aDomain = () => `claims-${unique()}.example`;

  /** Publish exactly these TXT values for any host. */
  const publish = (...values: string[]) => txt.mockResolvedValue(values.map((v) => [v]) as never);

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../../**/*.entity.{js,ts}`],
    });
    await ds.initialize();
    orgA = await ds.getRepository(Organization).save({ legalName: `DOM A ${unique()}` } as Organization);
    orgB = await ds.getRepository(Organization).save({ legalName: `DOM B ${unique()}` } as Organization);

    admin = new SsoAdminService(
      ds.getRepository(IdentityProvider),
      ds.getRepository(OrganizationDomain),
      {} as never,
      { get: () => undefined } as never,
      {} as never,
    );
    reverify = new SsoDomainReverificationService(
      ds,
      ds.getRepository(OrganizationDomain),
      ds.getRepository(IdentityProvider),
      { runOnce: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    txt.mockRestore();
    await ds?.destroy();
  });

  const claimOf = (id: string) => ds.getRepository(OrganizationDomain).findOneByOrFail({ id });

  it('lets two organizations hold a pending claim on the same domain, saying nothing about the other', async () => {
    const domain = aDomain();
    const a = await admin.addDomain(orgA.id, domain);
    const b = await admin.addDomain(orgB.id, domain);

    expect(a.verified).toBe(false);
    expect(b.verified).toBe(false);
    expect(a.dnsRecord.value).not.toBe(b.dnsRecord.value);
  });

  it('is idempotent for the same organization', async () => {
    const domain = aDomain();
    const first = await admin.addDomain(orgA.id, domain);
    const again = await admin.addDomain(orgA.id, domain.toUpperCase() + '.');
    expect(again.id).toBe(first.id);
  });

  it('verifies the organization that proves DNS control, and refuses the next one', async () => {
    const domain = aDomain();
    const a = await admin.addDomain(orgA.id, domain);
    const b = await admin.addDomain(orgB.id, domain);

    publish(a.dnsRecord.value, b.dnsRecord.value);
    await expect(admin.verifyDomain(orgA.id, a.id)).resolves.toEqual({ verified: true });
    await expect(admin.verifyDomain(orgB.id, b.id)).rejects.toBeInstanceOf(ConflictException);
    expect((await claimOf(b.id)).verified).toBe(false);
  });

  it('refuses a record that does not carry the organization\'s own token', async () => {
    const domain = aDomain();
    const a = await admin.addDomain(orgA.id, domain);
    publish('virteex-sso-verification=someone-else');
    await expect(admin.verifyDomain(orgA.id, a.id)).rejects.toThrow();
  });

  it('discards a pending claim that outlived its window', async () => {
    const domain = aDomain();
    const a = await admin.addDomain(orgA.id, domain);
    await ds.query(
      `UPDATE organization_domains SET created_at = now() - ($2 || ' milliseconds')::interval WHERE id = $1`,
      [a.id, String(PENDING_DOMAIN_CLAIM_TTL_MS + 60_000)],
    );

    const listed = await admin.listDomains(orgA.id);
    expect(listed.find((d) => d.id === a.id)).toBeUndefined();
  });

  describe('daily re-verification', () => {
    async function verifiedClaimWithIdp() {
      const domain = aDomain();
      const org = await ds.getRepository(Organization).save({ legalName: `DOM R ${unique()}` } as Organization);
      const claim = await admin.addDomain(org.id, domain);
      publish(claim.dnsRecord.value);
      await admin.verifyDomain(org.id, claim.id);
      const idp = await ds.getRepository(IdentityProvider).save({
        organizationId: org.id,
        name: 'Okta',
        issuerUrl: 'https://idp.example',
        clientId: 'c',
        clientSecretEncrypted: 'x',
        enabled: true,
      } as unknown as IdentityProvider);
      return { org, claimId: claim.id, idpId: idp.id };
    }

    it('keeps a claim whose record is still there', async () => {
      const { claimId } = await verifiedClaimWithIdp();
      const claim = await claimOf(claimId);
      publish(claim.verificationToken);

      await expect(reverify.recheck(claim)).resolves.toBe('present');
      expect(await claimOf(claimId)).toMatchObject({ verified: true, failedChecks: 0 });
    });

    it('does not count a DNS outage against anybody', async () => {
      const { claimId } = await verifiedClaimWithIdp();
      txt.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }));

      await expect(reverify.recheck(await claimOf(claimId))).resolves.toBe('unknown');
      expect(await claimOf(claimId)).toMatchObject({ verified: true, failedChecks: 0 });
    });

    it('lapses after consecutive absences and disables SSO for an organization left with no domain', async () => {
      const { claimId, idpId } = await verifiedClaimWithIdp();
      txt.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOTFOUND' }));

      for (let i = 1; i < DOMAIN_REVERIFY_FAILURE_THRESHOLD; i++) {
        await reverify.recheck(await claimOf(claimId));
        expect(await claimOf(claimId)).toMatchObject({ verified: true, failedChecks: i });
      }
      await reverify.recheck(await claimOf(claimId));

      expect(await claimOf(claimId)).toMatchObject({ verified: false, verifiedAt: null });
      const idp = await ds.getRepository(IdentityProvider).findOneByOrFail({ id: idpId });
      expect(idp.enabled).toBe(false);
    });
  });
});
