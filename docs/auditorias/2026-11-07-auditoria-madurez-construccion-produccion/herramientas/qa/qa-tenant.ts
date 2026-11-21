// QA-only: creates a QA- tenant through RegistrationService.completePendingRegistration (same path as demo:tenant).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../../../../../apps/backend/api/src/app/app.module';
import { RegistrationService } from '../../../../../apps/backend/api/src/app/auth/services/registration.service';
import { PendingRegistration, PendingRegistrationStatus } from '../../../../../apps/backend/api/src/app/auth/entities/pending-registration.entity';
import { LocalizationService } from '../../../../../apps/backend/api/src/app/localization/services/localization.service';
import { SaasService } from '../../../../../apps/backend/api/src/app/saas/saas.service';
const IDS: Record<string, string> = { DO: '131190317', US: '12-3456789', MX: 'DEM010203AB5', CL: '76086428-5', BR: '11222333000181', CO: '900373115', PE: '20100070970', AR: '30500010912' };
/** Local QA accounts only; chosen by whoever runs this, never committed. */
function qaPassword(): string {
  const value = process.env.QA_PASSWORD;
  if (!value || value.length < 12) throw new Error('Set QA_PASSWORD (12+ characters) for the QA tenants.');
  return value;
}

async function main() {
  const specs = (process.argv[2] ?? 'DO:a').split(',');
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error', 'warn'] });
  await app.init();
  const ds = app.get(DataSource), reg = app.get(RegistrationService), loc = app.get(LocalizationService), saas = app.get(SaasService);
  const [plan] = await saas.getPlans();
  for (const spec of specs) {
    const [cc, tag] = spec.split(':');
    const email = `qa-${cc.toLowerCase()}-${tag}@virtex.test`;
    const ex = await ds.query('SELECT id FROM users WHERE email=$1', [email]);
    if (ex.length) { console.log(`EXISTS ${email}`); continue; }
    const region = await loc.findRegionByCountryCode(cc);
    const repo = ds.getRepository(PendingRegistration);
    try {
      const p = await repo.save(repo.create({ email, firstName: 'QA', lastName: `${cc}-${tag}`, phone: null, phoneVerified: false,
        passwordHash: await argon2.hash(qaPassword(), { type: argon2.argon2id }), organizationName: `QA-${cc}-${tag.toUpperCase()} SRL`,
        taxId: process.env.QA_TAXID ?? ((cc === 'DO' && tag === 'b') ? '131246753' : (IDS[cc] ?? '131190317')), taxpayerKind: 'company', fiscalProfile: {}, fiscalRegionId: region!.id, industry: 'technology', companySize: '11-50',
        address: 'QA street 1', city: 'QA City', state: cc === 'US' ? 'TX' : '32', postalCode: '10101', countryCode: cc, planSlug: plan.slug,
        status: PendingRegistrationStatus.PENDING, expiresAt: new Date(Date.now() + 3600000) } as never));
      const u = await reg.completePendingRegistration(p.id, { customerId: `cus_qa_${cc}_${tag}`, subscriptionId: `sub_qa_${cc}_${tag}`, status: 'active', currentPeriodEnd: new Date(Date.now() + 365 * 864e5) });
      console.log(`CREATED ${email} org=${(u as any).organizationId}`);
    } catch (e: any) { console.log(`FAILED ${email}: ${e?.message}`); }
  }
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
