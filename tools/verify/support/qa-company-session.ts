/**
 * A freshly provisioned QA company, signed in over the real HTTP API — for the verifiers that must
 * prove a behaviour through the product rather than through a service.
 *
 * The application is booted as `main.ts` boots it (validation pipe, cookies, multipart, prefix), a
 * company is created through the path a paid signup takes, and its owner signs in; every call then
 * carries the session cookie and the CSRF token. Run as the application role (`DB_USERNAME=virtex_app`)
 * every write meets row-level security.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';

import { AppModule } from '../../../apps/backend/api/src/app/app.module';
import { LocalizationService } from '../../../apps/backend/api/src/app/localization/services/localization.service';
import { RegistrationService } from '../../../apps/backend/api/src/app/auth/services/registration.service';
import { I18nService } from '../../../apps/backend/api/src/app/i18n/i18n.service';
import { localizedValidationExceptionFactory } from '../../../apps/backend/api/src/app/i18n/validation-messages';
import {
  PendingRegistration,
  PendingRegistrationStatus,
} from '../../../apps/backend/api/src/app/auth/entities/pending-registration.entity';
import { runAsTenantJob } from '../../../apps/backend/api/src/app/shared/tenancy/tenant-job';
import { purgeProbeAccounts } from '../probe-cleanup';

/** A Dominican RNC with its DGII check digit (the probe needs a valid, unused one). */
function dominicanRnc(prefix: string): string {
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  const base = prefix.padStart(8, '0').slice(0, 8);
  const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const remainder = sum % 11;
  const digit = remainder === 0 ? 2 : remainder === 1 ? 1 : 11 - remainder;
  return `${base}${digit}`;
}

/** An Argentine company CUIT (prefix 30) with its AFIP check digit; the seed picks the eight digits. */
function argentineCompanyCuit(seed: number): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (let offset = 0; ; offset++) {
    const base = `30${String(10000000 + ((seed + offset) % 89999999)).slice(-8)}`;
    const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const digit = 11 - (sum % 11);
    if (digit === 10) continue; // Never issued: AFIP changes the prefix instead.
    return `${base}${digit === 11 ? 0 : digit}`;
  }
}

/** What the signup of a QA company in each market needs that differs between them. */
const MARKET_FIXTURES: Record<string, (stamp: number) => { taxId: string; city: string; state: string; postalCode: string }> = {
  DO: (stamp) => ({ taxId: dominicanRnc(String(13400000 + (stamp % 500000))), city: 'Santo Domingo', state: '32', postalCode: '10101' }),
  AR: (stamp) => ({ taxId: argentineCompanyCuit(stamp), city: 'Buenos Aires', state: 'C', postalCode: 'C1001' }),
};

function cookiesOf(raw: string | string[] | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return jar;
}

/** The application, booted as `main.ts` boots it. */
export async function bootApplication(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: ['error'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: localizedValidationExceptionFactory(app.get(I18nService)),
    }),
  );
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 }, attachFieldsToBody: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface QaCompanySession {
  organizationId: string;
  /** Sends a request as the company's owner. */
  call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, extraHeaders?: Record<string, string>): Promise<{
    statusCode: number;
    body: string;
    json<T = unknown>(): T;
  }>;
  /** Reads the company's own rows, in its tenant context. */
  query<T = Record<string, string>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Whether the owner signed in (the first check every verifier makes). */
  signedIn: boolean;
}

/**
 * A company of `country` (DO unless said otherwise) on `planSlug`, provisioned through signup —
 * the market's chart, taxes and policies — with its owner signed in.
 */
export async function qaCompanySession(
  app: NestFastifyApplication,
  label: string,
  planSlug = 'pro',
  country: keyof typeof MARKET_FIXTURES = 'DO',
): Promise<QaCompanySession> {
  const server = app.getHttpAdapter().getInstance();
  const ds = app.get(DataSource);
  // One source address per run: the login throttler is real (see `auth-http-contract.ts`).
  const stamp = Date.now();
  const remoteAddress = `127.${(stamp >> 16) & 0xff}.${(stamp >> 8) & 0xff}.${stamp & 0xff}`;
  await purgeProbeAccounts(ds);

  const email = `qa-${label.toLowerCase()}-${stamp}@example.test`;
  const password = 'QaVerificador!2026';
  const region = await app.get(LocalizationService).findRegionByCountryCode(country);
  if (!region) throw new Error(`No hay región fiscal ${country} sembrada.`);
  const market = MARKET_FIXTURES[country](stamp);
  const pendingRepo = ds.getRepository(PendingRegistration);
  const pending = await pendingRepo.save(
    pendingRepo.create({
      email,
      firstName: 'QA',
      lastName: label,
      phone: null,
      phoneVerified: false,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      organizationName: `QA-${label.toUpperCase()} ${stamp}`,
      taxId: market.taxId,
      taxpayerKind: 'company',
      fiscalProfile: {},
      fiscalRegionId: region.id,
      industry: 'technology',
      companySize: '1-10',
      address: 'Calle QA 3',
      city: market.city,
      state: market.state,
      postalCode: market.postalCode,
      countryCode: country,
      planSlug,
      status: PendingRegistrationStatus.PENDING,
      expiresAt: new Date(Date.now() + 3_600_000),
    } as never),
  );
  const owner = await app.get(RegistrationService).completePendingRegistration(pending.id, {
    customerId: `cus_qa_${stamp}`,
    subscriptionId: `sub_qa_${stamp}`,
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000),
  });
  const organizationId = (owner as unknown as { organizationId: string }).organizationId;

  const login = await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress });
  const jar = cookiesOf(login.headers['set-cookie'] as string[] | undefined);
  const csrf = jar['XSRF-TOKEN'] ?? jar['__Host-XSRF-TOKEN'];
  const cookie = Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return {
    organizationId,
    signedIn: login.statusCode === 200,
    async call(method, url, payload, extraHeaders = {}) {
      const response = await server.inject({
        method,
        url,
        payload: payload as never,
        remoteAddress,
        headers: { cookie, 'x-xsrf-token': csrf, ...extraHeaders },
      });
      return { statusCode: response.statusCode, body: response.body, json: <T>() => JSON.parse(response.body) as T };
    },
    query: <T>(sql: string, params: unknown[] = []) => runAsTenantJob(ds, organizationId, () => ds.query(sql, params)) as Promise<T[]>,
  };
}
