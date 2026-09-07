/**
 * Provisiona un inquilino de demostración con un usuario con el que se puede entrar.
 *
 * Existe para poder VER la aplicación: arranca el mismo camino que usa el webhook de pago
 * —`RegistrationService.completePendingRegistration`—, así que la empresa que crea tiene su
 * catálogo de cuentas, sus impuestos y sus roles como los tendría un cliente real. No es un
 * atajo que escribe filas a mano: si ese camino se rompe, esto se rompe con él.
 *
 *     npm run demo:tenant
 *     # → entra en http://localhost:4200 con demo@virtex.test / Demo1234!
 *
 * Nunca debe ejecutarse contra una base de producción: crea un usuario con contraseña conocida.
 * Se niega a arrancar si `NODE_ENV` es `production`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { RegistrationService } from '../../apps/backend/api/src/app/auth/services/registration.service';
import {
  PendingRegistration,
  PendingRegistrationStatus,
} from '../../apps/backend/api/src/app/auth/entities/pending-registration.entity';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { SaasService } from '../../apps/backend/api/src/app/saas/saas.service';

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@virtex.test';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo1234!';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('demo:tenant no se ejecuta en producción: crea un usuario con contraseña conocida.');
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    logger: ['error', 'warn'],
  });
  await app.init();

  const ds = app.get(DataSource);
  const registration = app.get(RegistrationService);
  const localization = app.get(LocalizationService);
  const saas = app.get(SaasService);

  const existing = await ds.query('SELECT id FROM users WHERE email = $1', [EMAIL]);
  if (existing.length > 0) {
    console.log(`El usuario ${EMAIL} ya existe. Nada que hacer.`);
    await app.close();
    return;
  }

  const region = await localization.findRegionByCountryCode('DO');
  if (!region) throw new Error('No hay región fiscal DO sembrada.');

  const [plan] = await saas.getPlans();
  if (!plan) throw new Error('No hay planes sembrados.');

  const repo = ds.getRepository(PendingRegistration);
  const pending = await repo.save(
    repo.create({
      email: EMAIL,
      firstName: 'Ana',
      lastName: 'Demostración',
      phone: null,
      phoneVerified: false,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      organizationName: 'Nortex Comercial',
      taxId: '131190317',
      taxpayerKind: 'company',
      fiscalProfile: {},
      fiscalRegionId: region.id,
      industry: 'technology',
      companySize: '11-50',
      address: 'Av. Winston Churchill 1515',
      city: 'Santo Domingo',
      state: '32',
      postalCode: '10101',
      countryCode: 'DO',
      planSlug: plan.slug,
      status: PendingRegistrationStatus.PENDING,
      expiresAt: new Date(Date.now() + 3_600_000),
    } as never),
  );

  const user = await registration.completePendingRegistration(pending.id, {
    customerId: 'cus_demo',
    subscriptionId: 'sub_demo',
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + 365 * 24 * 3_600_000),
  });

  const orgId = (user as unknown as { organizationId: string }).organizationId;
  const [{ n: accounts }] = await ds.query(
    'SELECT COUNT(*)::int AS n FROM accounts WHERE organization_id = $1',
    [orgId],
  );

  console.log(`\n  Empresa: Nortex Comercial (${orgId})`);
  console.log(`  Catálogo: ${accounts} cuentas contables`);
  console.log(`  Entra con: ${EMAIL} / ${PASSWORD}\n`);

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
