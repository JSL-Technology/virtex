/**
 * Executable proof that a paid signup produces a tenant that can keep books.
 *
 * ## What this exists to stop from happening again
 *
 * `ProfileRegistrationStrategy.provision()` — the call that gives a new tenant its country's
 * chart of accounts and taxes — had exactly one caller in the entire repository: its own unit
 * test. Registration was supposed to reach it through the `user.registered` event, and that
 * event's single listener had an empty body labelled "Placeholder implementation to satisfy build
 * requirements".
 *
 * So every customer who ever paid received an organization with zero accounts and zero taxes:
 * no journal entry, no invoice, no period close. The whole test suite was green, because no test
 * ever drove the registration path end to end.
 *
 * This drives `RegistrationService.completePendingRegistration` — the exact method the Stripe
 * webhook and `POST /auth/register-confirm` both call — and then asks the database what the
 * tenant actually got. It runs in CI.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { RegistrationService } from '../../apps/backend/api/src/app/auth/services/registration.service';
import {
  PendingRegistration,
  PendingRegistrationStatus,
} from '../../apps/backend/api/src/app/auth/entities/pending-registration.entity';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { SaasService } from '../../apps/backend/api/src/app/saas/saas.service';
import { User } from '../../apps/backend/api/src/app/users/entities/user.entity/user.entity';
import { findTaxScheme } from '../../apps/backend/api/src/app/localization/fiscal/country-tax-schemes';
import { purgeProbeAccounts } from './probe-cleanup';

/** A tax id that passes each country's real check-digit algorithm. */
const FISCAL_IDENTITIES: ReadonlyArray<{ country: string; taxId: string; kind: string }> = [
  { country: 'DO', taxId: '131190317', kind: 'company' },
  { country: 'US', taxId: '12-3456789', kind: 'company' },
  { country: 'MX', taxId: 'DEM010203AB5', kind: 'company' },
  { country: 'CL', taxId: '76086428-5', kind: 'company' },
  { country: 'BR', taxId: '11222333000181', kind: 'company' },
];

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

async function main() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    logger: ['error', 'warn'],
  });
  await app.init();

  const ds = app.get(DataSource);
  const registration = app.get(RegistrationService);
  const localization = app.get(LocalizationService);

  // These identities are fixed and well-formed, and `organizations` is uniquely indexed on
  // (tax_id, fiscal_region_id): without this the script passes once and fails on every run after.
  const purged = await purgeProbeAccounts(ds);
  if (purged > 0) console.log(`  · released ${purged} fiscal identity(ies) held by a previous run\n`);

  const saas = app.get(SaasService);

  const plans = await saas.getPlans();
  const plan = plans[0];
  if (!plan) {
    console.error('No plans seeded; SaasService.seedPlans did not run.');
    process.exit(1);
  }

  for (const identity of FISCAL_IDENTITIES) {
    const region = await localization.findRegionByCountryCode(identity.country);
    if (!region) {
      check(`${identity.country}: fiscal region seeded`, false);
      continue;
    }

    const email = `provisioning-probe-${identity.country.toLowerCase()}-${Date.now()}@example.test`;
    const repo = ds.getRepository(PendingRegistration);
    const pending = await repo.save(
      repo.create({
        email,
        firstName: 'Provisioning',
        lastName: 'Probe',
        phone: null,
        phoneVerified: false,
        // A real Argon2id hash; this path never verifies it, but the column is NOT NULL.
        passwordHash:
          '$argon2id$v=19$m=65536,t=3,p=4$nQX58JdpAHj04FlImXHVGg$KqRBXlHTOlTtTorAd6friuDAvPPmpa+0E7cDUf/5p9I',
        organizationName: `Probe ${identity.country}`,
        taxId: identity.taxId,
        taxpayerKind: identity.kind,
        fiscalProfile: {},
        fiscalRegionId: region.id,
        industry: 'technology',
        companySize: '1-10',
        address: 'Calle Probe 1',
        city: 'Ciudad Probe',
        state: identity.country === 'US' ? 'TX' : '32',
        postalCode: '10101',
        countryCode: identity.country,
        planSlug: plan.slug,
        status: PendingRegistrationStatus.PENDING,
        expiresAt: new Date(Date.now() + 3_600_000),
      } as never),
    );

    let user: User;
    try {
      user = await registration.completePendingRegistration(pending.id, {
        customerId: `cus_probe_${identity.country}`,
        subscriptionId: `sub_probe_${identity.country}`,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000),
      });
    } catch (e) {
      check(`${identity.country}: signup materialises`, false, (e as Error).message);
      continue;
    }

    const orgId = (user as unknown as { organizationId: string }).organizationId;
    const countOf = async (table: string): Promise<number> =>
      Number(
        (
          await ds.query(
            `SELECT COUNT(*)::int AS n FROM ${table} WHERE organization_id = $1`,
            [orgId],
          )
        )[0].n,
      );

    const accounts = await countOf('accounts');
    const taxes = await countOf('taxes');
    const roles = await countOf('roles');
    const memberships = await countOf('user_organizations');
    const org = (
      await ds.query(
        `SELECT plan_id, subscription_status, tax_id, tax_id_verified_at FROM organizations WHERE id = $1`,
        [orgId],
      )
    )[0];

    // The whole point: an ERP tenant with no ledger is not a tenant.
    check(`${identity.country}: chart of accounts provisioned`, accounts >= 25, `${accounts} accounts`);
    check(`${identity.country}: roles created`, roles >= 3, `${roles} roles`);
    check(`${identity.country}: owner membership written`, memberships === 1, `${memberships} rows`);
    check(`${identity.country}: plan assigned`, Boolean(org?.plan_id));
    check(
      `${identity.country}: subscription recorded`,
      org?.subscription_status === 'active',
      String(org?.subscription_status),
    );
    check(`${identity.country}: fiscal identity verified`, Boolean(org?.tax_id_verified_at));

    // Brazil and the United States have no single national consumption tax to seed, and their
    // schemes say so; everywhere else a signup without taxes cannot issue a compliant document.
    const expectsTaxes = !findTaxScheme(identity.country)?.configurationRequired;
    if (expectsTaxes) {
      check(`${identity.country}: taxes provisioned`, taxes >= 1, `${taxes} taxes`);
    } else {
      check(`${identity.country}: taxes deferred by design`, taxes === 0, `${taxes} taxes`);
    }

    // Idempotency: the Stripe webhook and the browser redirect race each other, and both call
    // this. A second call must return the same account, not a second one.
    const again = await registration.completePendingRegistration(pending.id, {
      customerId: `cus_probe_${identity.country}`,
      subscriptionId: `sub_probe_${identity.country}`,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000),
    });
    check(`${identity.country}: completion is idempotent`, again.id === user.id);
    check(
      `${identity.country}: no duplicate chart of accounts`,
      (await countOf('accounts')) === accounts,
    );
  }

  console.log(
    failures.length
      ? `\nFAILURES:\n${failures.map((f) => `  - ${f}`).join('\n')}`
      : '\nEVERY SIGNUP PRODUCES A TENANT THAT CAN KEEP BOOKS',
  );
  await app.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
