/**
 * Executable proof, against a real Postgres, that a tenant's fiscal identity survives being
 * stored — and that the unique index no longer collides distinct taxpayers.
 *
 * The defect this pins: registration persisted `taxId.replace(/[^\d]/g, '')`, deleting every
 * non-digit for every country. `organizations` carries a unique index on
 * `(tax_id, fiscal_region_id)`, so in the six markets where that stripped meaningful characters
 * two DIFFERENT companies collapsed to the same stored value, and the second one to sign up was
 * refused with a generic conflict — after paying. A unit test cannot show that: the failure is
 * the database constraint firing on the second insert, so the check has to reach a real database.
 *
 *   npm run verify:fiscal-identity
 *
 * ## Why it boots the application rather than opening a connection
 *
 * Every check below needs a row in `fiscal_regions` for the country it is about, and the script
 * used to open `AppDataSource` directly and assume somebody had already put them there. Nothing
 * had: the regions are seeded by `LocalizationService.onModuleInit`, which only runs when the
 * application starts — and in CI this step runs BEFORE `verify:boot`. So all nine of the checks
 * that need a region reported `no fiscal region seeded` and the step failed, on a clean database,
 * for a reason that had nothing to do with what it verifies.
 *
 * Booting the real `AppModule` seeds them through the product's own path, which is also the path
 * a real deployment uses. It costs a few seconds and removes the dependency on the order the
 * verification steps happen to run in.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { Organization } from '../../apps/backend/api/src/app/organizations/entities/organization.entity';
import { FiscalRegion } from '../../apps/backend/api/src/app/localization/entities/fiscal-region.entity';
import {
  canonicalizeTaxId,
  validateTaxId,
  TaxpayerKind,
} from '../../apps/backend/api/src/app/localization/fiscal/tax-id-validators';
import { validateFiscalFields } from '../../apps/backend/api/src/app/localization/fiscal/country-profiles';
import { purgeProbeAccounts } from './probe-cleanup';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const RESET = '\u001b[0m';

let failures = 0;
const ok = (label: string, detail = '') =>
  console.log(`  ${GREEN}OK${RESET}   ${label}${detail ? '  — ' + detail : ''}`);
const bad = (label: string, detail = '') => {
  failures++;
  console.log(`  ${RED}FAIL${RESET} ${label}${detail ? '  — ' + detail : ''}`);
};

/**
 * Pairs of DISTINCT taxpayers that the old digits-only storage collapsed onto one value.
 * Each pair must now produce two separate rows.
 */
const COLLIDING_PAIRS: Array<[string, string, string, string]> = [
  ['MX', 'DEM010203AB5', 'XYZ010203AB5', 'two companies incorporated on the same day'],
  ['VE', 'J-30599168-5', 'V-30599168-5', 'a company and a natural person'],
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  const ds = app.get(DataSource);
  const orgs = ds.getRepository(Organization);
  const regions = ds.getRepository(FiscalRegion);
  const created: string[] = [];

  // The identities below are the same well-formed ones `verify:provisioning` registers, and
  // `organizations` is uniquely indexed on (tax_id, fiscal_region_id). Two verification scripts
  // sharing one database must not depend on the order they happen to run in: whichever ran second
  // failed on a duplicate key and reported it as the product colliding distinct taxpayers, which
  // is the precise opposite of what it proves.
  const released = await purgeProbeAccounts(ds);
  if (released > 0) console.log(`\n  · released ${released} fiscal identity(ies) held by a previous run`);

  try {
    console.log('\nCanonical form is preserved end to end');
    for (const [country, value] of [
      ['MX', 'DEM010203AB5'],
      ['CL', '76.086.428-5'],
      ['VE', 'J-30599168-5'],
      ['GT', '1234567-9'],
      ['NI', 'J0310000012345'],
      ['PA', '15512345-2-2018'],
      ['DO', '131-12345-7'],
    ] as const) {
      const region = await regions.findOne({ where: { countryCode: country } });
      if (!region) {
        bad(`${country}: no fiscal region seeded`);
        continue;
      }
      const canonical = canonicalizeTaxId(country, value);
      const saved = await orgs.save(
        orgs.create({
          legalName: `Roundtrip ${country} ${Date.now()}`,
          taxId: canonical,
          fiscalRegionId: region.id,
          country,
          taxpayerKind: TaxpayerKind.COMPANY,
          taxIdVerifiedAt: new Date(),
        }),
      );
      created.push(saved.id);

      const reloaded = await orgs.findOneByOrFail({ id: saved.id });
      if (reloaded.taxId === canonical && canonicalizeTaxId(country, reloaded.taxId) === canonical) {
        ok(`${country} ${value}`, `stored as ${reloaded.taxId}`);
      } else {
        bad(`${country} ${value}`, `stored as ${reloaded.taxId}, expected ${canonical}`);
      }
    }

    // The next phase re-inserts some of the same identifiers, and they are unique per fiscal
    // region by design. Clear this phase's rows first so a collision reported below is the
    // product's behaviour and not this script tripping over its own fixtures.
    if (created.length) {
      await orgs.delete(created);
      created.length = 0;
    }

    console.log('\nDistinct taxpayers no longer collide on the unique index');
    for (const [country, a, b, why] of COLLIDING_PAIRS) {
      const region = await regions.findOne({ where: { countryCode: country } });
      if (!region) {
        bad(`${country}: no fiscal region seeded`);
        continue;
      }
      const stamp = Date.now();
      try {
        for (const value of [a, b]) {
          const saved = await orgs.save(
            orgs.create({
              legalName: `Collision ${country} ${value} ${stamp}`,
              taxId: canonicalizeTaxId(country, value),
              fiscalRegionId: region.id,
              country,
              taxpayerKind: TaxpayerKind.COMPANY,
              taxIdVerifiedAt: new Date(),
            }),
          );
          created.push(saved.id);
        }
        ok(`${country}: ${a} and ${b} coexist`, why);
      } catch (error) {
        bad(`${country}: ${a} and ${b} collided`, (error as Error).message.split('\n')[0]);
      }
    }

    console.log('\nThe same values under the OLD storage rule would have collided');
    for (const [country, a, b] of COLLIDING_PAIRS) {
      const oldA = a.replace(/[^\d]/g, '');
      const oldB = b.replace(/[^\d]/g, '');
      if (oldA === oldB) {
        ok(`${country}: digits-only storage mapped both to "${oldA}"`, 'which the unique index refused');
      } else {
        bad(`${country}: expected the old rule to collide; it did not`);
      }
    }

    console.log('\nValidation and the country catalogue agree with what is stored');
    const checks: Array<[string, string, TaxpayerKind, Record<string, string>]> = [
      ['MX', 'DEM010203AB5', TaxpayerKind.COMPANY, { regimenFiscal: '601' }],
      ['AR', '30-71234567-1', TaxpayerKind.COMPANY, { condicionIva: '1', puntoVenta: '0001' }],
      ['BR', '11.222.333/0001-81', TaxpayerKind.COMPANY, { regimeTributario: '1', inscricaoEstadual: 'ISENTO' }],
      ['US', '078-05-1120', TaxpayerKind.INDIVIDUAL, {}],
      ['EC', '1710034065001', TaxpayerKind.INDIVIDUAL, { obligadoContabilidad: 'SI' }],
    ];
    for (const [country, taxId, kind, profile] of checks) {
      const validId = validateTaxId(country, taxId, kind);
      const fieldErrors = validateFiscalFields(country, kind, profile);
      if (validId && fieldErrors.length === 0) {
        ok(`${country} ${taxId} as ${kind}`, 'fiscal profile accepted');
      } else {
        bad(
          `${country} ${taxId} as ${kind}`,
          validId ? `fiscal profile rejected: ${JSON.stringify(fieldErrors)}` : 'tax id rejected',
        );
      }
    }
  } finally {
    if (created.length) {
      await orgs.delete(created);
    }
    await app.close();
  }

  if (failures > 0) {
    console.error(`\n${RED}${failures} check(s) failed${RESET}\n`);
    process.exit(1);
  }
  console.log('\nFISCAL IDENTITY SURVIVES STORAGE, AND DISTINCT TAXPAYERS STAY DISTINCT\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
