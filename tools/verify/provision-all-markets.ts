/**
 * Executable proof, against a real Postgres, that every supported market provisions a tenant that
 * can actually keep books: fiscal region seeded, taxes created, and a chart of accounts created
 * with both sides of the VAT return present.
 *
 * ## Why this boots the real application
 *
 * The previous version hand-wired `LocalizationService` and, in its own words, replaced the chart
 * of accounts writer with "a minimal chart-of-accounts writer: the real service pulls in BullMQ
 * and the audit trail, neither of which is what is under test here". That stub did not validate
 * account segments, and it created its probe organizations straight through the repository, so
 * they never received a segment definition to validate against.
 *
 * Both omissions hid the same defect: the real `ChartOfAccountsService` refuses an account whose
 * segment count differs from the organization's structure, and the real `OrganizationsService`
 * gave every organization a four-level structure while the templates emitted one segment. Every
 * tenant in every market failed on its first account — and this script printed
 * "ALL MARKETS PROVISION CLEANLY".
 *
 * A verification that substitutes the component containing the defect is not a verification. This
 * one boots the actual `AppModule` and goes through `OrganizationsService.create` and
 * `LocalizationService.applyFiscalPackage`, which is the exact pair the signup calls.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { FiscalRegion } from '../../apps/backend/api/src/app/localization/entities/fiscal-region.entity';
import { Organization } from '../../apps/backend/api/src/app/organizations/entities/organization.entity';
import { Tax } from '../../apps/backend/api/src/app/taxes/entities/tax.entity';
import { Account } from '../../apps/backend/api/src/app/chart-of-accounts/entities/account.entity';
import { AccountSegmentDefinition } from '../../apps/backend/api/src/app/chart-of-accounts/entities/account-segment-definition.entity';
import { supportedCountryCodes } from '../../apps/backend/api/src/app/localization/fiscal/country-profiles';
import { coaSegmentsFor } from '../../apps/backend/api/src/app/localization/fiscal/coa-builder';
import {
  findTaxScheme,
  principalTaxName,
} from '../../apps/backend/api/src/app/localization/fiscal/country-tax-schemes';

async function main() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    logger: ['error', 'warn'],
  });
  await app.init();

  const ds = app.get(DataSource);
  const localization = app.get(LocalizationService);
  const organizations = app.get(OrganizationsService);

  const regions = await ds.getRepository(FiscalRegion).find();
  console.log(`fiscal regions seeded: ${regions.length}`);

  const failures: string[] = [];

  for (const code of supportedCountryCodes()) {
    const region = regions.find((r) => r.countryCode === code);
    if (!region) {
      failures.push(`${code}: no fiscal region`);
      continue;
    }

    // Created exactly as the signup creates it, so the organization receives the same account
    // segment structure the real chart of accounts will be validated against.
    let org: Organization;
    try {
      org = await organizations.create({
        legalName: `Probe ${code}`,
        country: code,
        fiscalRegionId: region.id,
      });
    } catch (e) {
      failures.push(`${code}: organization could not be created — ${(e as Error).message}`);
      continue;
    }

    try {
      await localization.applyFiscalPackage(org);
    } catch (e) {
      failures.push(`${code}: applyFiscalPackage threw — ${(e as Error).message}`);
      continue;
    }

    const taxes = await ds.getRepository(Tax).find({ where: { organizationId: org.id } });
    const accounts = await ds
      .getRepository(Account)
      .find({ where: { organizationId: org.id }, relations: ['segments'] });
    const segmentDefs = await ds
      .getRepository(AccountSegmentDefinition)
      .find({ where: { organizationId: org.id } });

    const scheme = findTaxScheme(code)!;
    const taxName = principalTaxName(code);
    // `Account.name` is a localised JSONB map (`{ es: '…' }`), not a string — the real service
    // converts it on write. The previous stub stored the raw string, which is one more way that
    // harness diverged from the code it claimed to verify.
    const nameOf = (a: Account): string => {
      const value = a.name as unknown;
      if (typeof value === 'string') return value;
      return Object.values((value ?? {}) as Record<string, string>).join(' ');
    };
    const taxAccounts = accounts.filter((a) => nameOf(a).includes(taxName));

    const expectedTaxes = scheme.taxes.length;
    const expectedSegments = coaSegmentsFor(code).length;
    const problems: string[] = [];

    if (taxes.length !== expectedTaxes) problems.push(`taxes ${taxes.length} != ${expectedTaxes}`);
    if (accounts.length < 25) problems.push(`only ${accounts.length} accounts`);
    if (!scheme.configurationRequired && taxAccounts.length < 2) {
      problems.push(`only ${taxAccounts.length} "${taxName}" accounts`);
    }

    // The structure the organization was given, and the codes the chart was written in, are the
    // pair that used to disagree. Assert both, not just the counts.
    if (segmentDefs.length !== expectedSegments) {
      problems.push(`segment definitions ${segmentDefs.length} != ${expectedSegments}`);
    }
    const misshaped = accounts.filter((a) => (a.segments ?? []).length !== expectedSegments);
    if (misshaped.length > 0) {
      problems.push(`${misshaped.length} accounts with the wrong segment count`);
    }

    const flag = problems.length ? `✗ ${problems.join('; ')}` : '✓';
    console.log(
      `${code}  accounts=${String(accounts.length).padStart(2)}  taxes=${taxes.length}  ` +
        `seg=${segmentDefs.length}  ${taxName.padEnd(12)} ${flag}`,
    );
    if (problems.length) failures.push(`${code}: ${problems.join('; ')}`);
  }

  console.log(
    failures.length
      ? `\nFAILURES:\n${failures.join('\n')}`
      : '\nALL MARKETS PROVISION CLEANLY (through the real services)',
  );
  await app.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
