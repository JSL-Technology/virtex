/**
 * Executable proof, against a real Postgres, that every supported market provisions a usable
 * tenant: fiscal region seeded, taxes created, chart of accounts created with both sides of the
 * VAT return present.
 */
import 'reflect-metadata';
import { AppDataSource } from '../../apps/backend/api/src/app/database/data-source';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { FiscalRegion } from '../../apps/backend/api/src/app/localization/entities/fiscal-region.entity';
import { Organization } from '../../apps/backend/api/src/app/organizations/entities/organization.entity';
import { Tax } from '../../apps/backend/api/src/app/taxes/entities/tax.entity';
import { Account } from '../../apps/backend/api/src/app/chart-of-accounts/entities/account.entity';
import { supportedCountryCodes } from '../../apps/backend/api/src/app/localization/fiscal/country-profiles';
import { findTaxScheme, principalTaxName } from '../../apps/backend/api/src/app/localization/fiscal/country-tax-schemes';
import { TaxesService } from '../../apps/backend/api/src/app/taxes/taxes.service';

async function main() {
  const ds = await AppDataSource.initialize();

  const taxesService = new TaxesService(ds.getRepository(Tax) as never);

  // A minimal chart-of-accounts writer: the real service pulls in BullMQ and the audit trail,
  // neither of which is what is under test here. What IS under test is that every account the
  // template produces is accepted by the real table and its constraints.
  const coaService = {
    async create(dto: any, organizationId: string) {
      const account = ds.getRepository(Account).create({
        name: dto.name,
        type: dto.type,
        category: dto.category,
        nature: dto.nature,
        isPostable: dto.isPostable,
        parentId: dto.parentId ?? null,
        organizationId,
      } as any);
      return ds.getRepository(Account).save(account);
    },
  };

  const service = new LocalizationService(
    ds.getRepository(FiscalRegion),
    coaService as never,
    taxesService,
    { getTaxIdDetails: async () => null } as never,
    { getTaxIdDetails: async () => null } as never,
    { getTaxIdDetails: async () => null } as never,
  );

  await service.onModuleInit();

  const regions = await ds.getRepository(FiscalRegion).find();
  console.log(`fiscal regions seeded: ${regions.length}`);

  const failures: string[] = [];
  for (const code of supportedCountryCodes()) {
    const region = regions.find((r) => r.countryCode === code);
    if (!region) { failures.push(`${code}: no fiscal region`); continue; }

    const org = await ds.getRepository(Organization).save(
      ds.getRepository(Organization).create({
        legalName: `Probe ${code}`,
        country: code,
        fiscalRegionId: region.id,
      } as any),
    ) as unknown as Organization;

    try {
      await service.applyFiscalPackage(org);
    } catch (e) {
      failures.push(`${code}: applyFiscalPackage threw — ${(e as Error).message}`);
      continue;
    }

    const taxes = await ds.getRepository(Tax).find({ where: { organizationId: org.id } });
    const accounts = await ds.getRepository(Account).find({ where: { organizationId: org.id } });
    const scheme = findTaxScheme(code)!;
    const taxName = principalTaxName(code);
    const taxAccounts = accounts.filter((a) => a.name.includes(taxName));

    const expectedTaxes = scheme.taxes.length;
    const problems: string[] = [];
    if (taxes.length !== expectedTaxes) problems.push(`taxes ${taxes.length} != ${expectedTaxes}`);
    if (accounts.length < 25) problems.push(`only ${accounts.length} accounts`);
    if (!scheme.configurationRequired && taxAccounts.length < 2) {
      problems.push(`only ${taxAccounts.length} "${taxName}" accounts`);
    }

    const flag = problems.length ? `✗ ${problems.join('; ')}` : '✓';
    console.log(
      `${code}  accounts=${String(accounts.length).padStart(2)}  taxes=${taxes.length}  ${taxName.padEnd(12)} ${flag}`,
    );
    if (problems.length) failures.push(`${code}: ${problems.join('; ')}`);
  }

  console.log(failures.length ? `\nFAILURES:\n${failures.join('\n')}` : '\nALL MARKETS PROVISION CLEANLY');
  await ds.destroy();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
