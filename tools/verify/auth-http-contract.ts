/**
 * Executable proof of the authentication surface, over real HTTP, against a real Postgres.
 *
 * ## Why this exists
 *
 * The two e2e projects in this workspace were the Nx scaffolding, untouched:
 * `apps/backend/api-e2e` asserted that `GET /api` returns `{ message: 'Hello API' }`, and
 * `client-web-e2e` looked for the word "Welcome". Neither route nor word exists in the product.
 * So the flow that takes a customer's money and signs them in — nineteen markets of fiscal
 * validation, a payment-first signup, cookie-only tokens, signed double-submit CSRF, refresh
 * rotation with reuse detection — had no end-to-end coverage of any kind.
 *
 * This drives the real application through Fastify's `inject`, so it exercises the whole pipeline
 * (global guards, the validation pipe, cookie serialisation, the exception filters) without
 * needing a port, a second process or a browser. It runs in CI.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { RegistrationService } from '../../apps/backend/api/src/app/auth/services/registration.service';
import { SaasService } from '../../apps/backend/api/src/app/saas/saas.service';
import { JwtService } from '@nestjs/jwt';
import { AuthConfig } from '../../apps/backend/api/src/app/auth/auth.config';
import { purgeProbeAccounts } from './probe-cleanup';
import {
  PendingRegistration,
  PendingRegistrationStatus,
} from '../../apps/backend/api/src/app/auth/entities/pending-registration.entity';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

/** Parse `Set-Cookie` into name → { value, attributes }. */
function parseCookies(raw: string | string[] | undefined): Record<
  string,
  { value: string; attrs: Record<string, string | true> }
> {
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const jar: Record<string, { value: string; attrs: Record<string, string | true> }> = {};

  for (const line of all) {
    const [pair, ...rest] = line.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    const attrs: Record<string, string | true> = {};
    for (const attr of rest) {
      const eq = attr.indexOf('=');
      if (eq === -1) attrs[attr.trim().toLowerCase()] = true;
      else attrs[attr.slice(0, eq).trim().toLowerCase()] = attr.slice(eq + 1).trim();
    }
    jar[name] = { value, attrs };
  }
  return jar;
}

const cookieHeader = (jar: Record<string, { value: string }>): string =>
  Object.entries(jar)
    .map(([name, { value }]) => `${name}=${value}`)
    .join('; ');

async function main() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ['error'],
  });
  // The same pipe main.ts registers: one error per field, and unknown properties rejected.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
    }),
  );
  await app.register(fastifyCookie);
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const server = app.getHttpAdapter().getInstance();

  /**
   * Every request in this run comes from one source address, and a DIFFERENT one each run.
   *
   * The login throttler is real — five attempts per address per minute — and the probe spends
   * three of them proving that a wrong password and an unknown mailbox are indistinguishable.
   * Two runs inside the same minute therefore hit the limit, and the script reported a 429 as
   * "a correct password does not sign in": a passing product failing its own verification. The
   * throttler is not disabled here, because its behaviour is part of what this proves; the probe
   * simply stops pretending that two independent runs are the same client.
   */
  const probeAddress = `127.${(Date.now() >> 16) & 0xff}.${(Date.now() >> 8) & 0xff}.${
    (Date.now() % 254) + 1
  }`;
  const inject = (options: Parameters<typeof server.inject>[0]) =>
    server.inject({ remoteAddress: probeAddress, ...(options as object) } as never);
  const ds = app.get(DataSource);
  const localization = app.get(LocalizationService);
  const registration = app.get(RegistrationService);
  const saas = app.get(SaasService);

  // The probe registers a real Dominican RNC, and `organizations` is uniquely indexed on
  // (tax_id, fiscal_region_id). Without this the script passes once and then fails on every run
  // after, on a machine where nothing has regressed.
  const purged = await purgeProbeAccounts(ds);
  if (purged > 0) console.log(`  · released ${purged} fiscal identity(ies) held by a previous run\n`);

  // ---------------------------------------------------------------------------------------
  // A real, paid tenant to sign in as.
  // ---------------------------------------------------------------------------------------
  const password = 'C0ntract!Probe#2026';
  const email = `http-contract-${Date.now()}@example.test`;
  const region = await localization.findRegionByCountryCode('DO');
  const plan = (await saas.getPlans())[0];

  const pendingRepo = ds.getRepository(PendingRegistration);
  const pending = await pendingRepo.save(
    pendingRepo.create({
      email,
      firstName: 'Contract',
      lastName: 'Probe',
      phone: null,
      phoneVerified: false,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      organizationName: 'Contract Probe SRL',
      taxId: '130862346',
      taxpayerKind: 'company',
      fiscalProfile: {},
      fiscalRegionId: region!.id,
      industry: 'technology',
      companySize: '1-10',
      address: 'Calle Probe 1',
      city: 'Santo Domingo',
      state: '32',
      postalCode: '10101',
      countryCode: 'DO',
      planSlug: plan.slug,
      status: PendingRegistrationStatus.PENDING,
      expiresAt: new Date(Date.now() + 3_600_000),
    } as never),
  );
  await registration.completePendingRegistration(pending.id, {
    customerId: 'cus_contract',
    subscriptionId: 'sub_contract',
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000),
  });

  // ---------------------------------------------------------------------------------------
  // The public fiscal configuration the signup form is built from.
  // ---------------------------------------------------------------------------------------
  const countries = await inject({ method: 'GET', url: '/api/v1/localization/countries' });
  check('countries are published without authentication', countries.statusCode === 200);
  check('every supported market is offered', countries.json<unknown[]>().length >= 19);

  const usConfig = await inject({ method: 'GET', url: '/api/v1/localization/config/US' });
  const us = usConfig.json<Record<string, never>>();
  check('a country publishes its own fiscal specification', usConfig.statusCode === 200);
  check(
    'the United States publishes the SSN/ITIN alternative to an EIN',
    Boolean((us as { individualDocument?: unknown }).individualDocument),
  );
  check(
    'the United States publishes its states as coded divisions',
    ((us as { address: { divisions?: unknown[] } }).address.divisions ?? []).length === 52,
  );

  // ---------------------------------------------------------------------------------------
  // Signup validation — country-aware, and rejecting before any charge.
  // ---------------------------------------------------------------------------------------
  const badMexican = await inject({
    method: 'POST',
    url: '/api/v1/auth/register-checkout',
    payload: {
      organizationName: 'Prueba SA de CV',
      countryCode: 'MX',
      taxpayerKind: 'company',
      taxId: 'XAXX010101000',
      firstName: 'A',
      lastName: 'B',
      email: 'mx-probe@example.test',
      password,
      address: 'Av. Reforma 1',
      city: 'CDMX',
      state: '09',
      postalCode: '06600',
      planId: plan.slug,
    },
  });
  const mexicanErrors: string[] = badMexican.json<{ message: string[] }>().message ?? [];
  check('an invalid RFC is refused', badMexican.statusCode === 400);
  check(
    'the refusal names the RFC specifically',
    mexicanErrors.some((m) => m.includes('RFC')),
    mexicanErrors[0],
  );
  check(
    "Mexico's régimen fiscal is demanded",
    mexicanErrors.some((m) => m.toLowerCase().includes('régimen')),
  );
  check(
    'no English validator message leaks into a Spanish response',
    !mexicanErrors.some((m) => /must be|should not|is not a valid/i.test(m)),
    mexicanErrors.find((m) => /must be|should not/i.test(m)) ?? '',
  );

  const missingAddress = await inject({
    method: 'POST',
    url: '/api/v1/auth/register-checkout',
    payload: {
      organizationName: 'Probe',
      countryCode: 'DO',
      taxpayerKind: 'company',
      taxId: '131190317',
      firstName: 'A',
      lastName: 'B',
      email: 'do-probe@example.test',
      password,
      fiscalProfile: { tipoIngreso: '01' },
      city: 'Santo Domingo',
      state: '32',
      planId: plan.slug,
    },
  });
  const addressErrors: string[] = missingAddress.json<{ message: string[] }>().message ?? [];
  check(
    'one empty field produces exactly one error, not three contradictory ones',
    addressErrors.filter((m) => m.toLowerCase().includes('direcci')).length === 1,
    addressErrors.filter((m) => m.toLowerCase().includes('direcci')).join(' | '),
  );

  /**
   * The signup gates, driven at the service.
   *
   * Over HTTP the plan's Stripe Price is resolved first, so with billing unconfigured — the
   * documented local setup — the request never reaches these. What they pin is the ORDER, which
   * is a security decision: control of the mailbox is proven before the platform will say
   * anything about which fiscal identities it already knows.
   */
  const baseSignup = {
    organizationName: 'Otra Empresa',
    countryCode: 'DO',
    taxpayerKind: 'company',
    taxId: '130862346', // the identity registered above
    firstName: 'A',
    lastName: 'B',
    password,
    fiscalProfile: { tipoIngreso: '01' },
    address: 'Calle 2',
    city: 'Santo Domingo',
    state: '32',
    postalCode: '10101',
  };

  let emailGateEnforced = false;
  try {
    await registration.createPendingRegistration(
      { ...baseSignup, email: `unverified-${Date.now()}@example.test` } as never,
      plan.slug,
    );
  } catch (e) {
    emailGateEnforced = /verificación de correo/i.test((e as Error).message);
  }
  check('signup demands a verified email before anything else', emailGateEnforced);

  /**
   * A duplicate fiscal identity is refused BEFORE Stripe is called — but only once the mailbox is
   * proven, so the endpoint cannot be used as an oracle for "is this RNC already a customer".
   *
   * The pre-verified token is the same one the email magic link issues; minting it here is how
   * the check can be reached without a mailbox.
   */
  const duplicateEmail = `dup-${Date.now()}@example.test`;
  const preVerified = app.get(JwtService).sign(
    { sub: duplicateEmail, verType: 'EMAIL_VERIFY', type: 'VERIFICATION_PRE_VERIFIED' },
    { secret: AuthConfig.JWT_PREVERIFY_SECRET, expiresIn: '10m' },
  );

  let duplicateRejected = false;
  let duplicateDetail = '';
  try {
    await registration.createPendingRegistration(
      { ...baseSignup, email: duplicateEmail, emailVerificationCode: preVerified } as never,
      plan.slug,
    );
  } catch (e) {
    duplicateRejected = (e as { status?: number }).status === 409;
    duplicateDetail = `${(e as { status?: number }).status} ${(e as Error).message}`;
  }
  check(
    'a tax id already registered is refused BEFORE checkout, not after the charge',
    duplicateRejected,
    duplicateRejected ? '' : duplicateDetail,
  );

  // ---------------------------------------------------------------------------------------
  // Sign in.
  // ---------------------------------------------------------------------------------------
  const wrongPassword = await inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'WrongPassword!123' },
  });
  const unknownAccount = await inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'nobody-at-all@example.test', password: 'WrongPassword!123' },
  });
  check(
    'an unknown address and a wrong password are indistinguishable',
    wrongPassword.statusCode === unknownAccount.statusCode &&
      wrongPassword.body === unknownAccount.body,
  );

  const login = await inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  check('a correct password signs in', login.statusCode === 200, String(login.statusCode));

  const jar = parseCookies(login.headers['set-cookie'] as string[] | undefined);
  const access = jar['access_token'] ?? jar['__Host-access_token'];
  const refresh = jar['refresh_token'] ?? jar['__Secure-refresh_token'];
  const csrf = jar['XSRF-TOKEN'] ?? jar['__Host-XSRF-TOKEN'];

  check('the access token is delivered as a cookie', Boolean(access));
  check('the access token is httpOnly', Boolean(access?.attrs['httponly']));
  check('no token appears in the response body', !/accessToken|refreshToken/.test(login.body));
  check(
    'the refresh cookie is scoped to the refresh route only',
    String(refresh?.attrs['path']).endsWith('/auth/refresh'),
    String(refresh?.attrs['path']),
  );

  /**
   * `Max-Age` is defined in SECONDS. The whole codebase carries durations in milliseconds and
   * every call site passed them straight through, so a fifteen-minute cookie was issued with
   * `Max-Age=900000` — ten and a half days — and the refresh cookie with roughly nineteen years.
   */
  check(
    'the access cookie expires in fifteen minutes, not ten days',
    Number(access?.attrs['max-age']) === 900,
    `Max-Age=${access?.attrs['max-age']}`,
  );
  check(
    'the refresh cookie expires in seven days, not nineteen years',
    Number(refresh?.attrs['max-age']) === 604800,
    `Max-Age=${refresh?.attrs['max-age']}`,
  );

  // ---------------------------------------------------------------------------------------
  // CSRF and refresh rotation.
  // ---------------------------------------------------------------------------------------
  const refreshWithoutHeader = await inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: { cookie: cookieHeader(jar) },
  });
  check(
    'a state-changing call without the CSRF header is refused',
    refreshWithoutHeader.statusCode === 403,
    String(refreshWithoutHeader.statusCode),
  );

  const refreshed = await inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: { cookie: cookieHeader(jar), 'x-xsrf-token': csrf.value },
  });
  check('a refresh with the CSRF header succeeds', refreshed.statusCode === 200);

  const rotated = parseCookies(refreshed.headers['set-cookie'] as string[] | undefined);
  const newRefresh = rotated['refresh_token'] ?? rotated['__Secure-refresh_token'];
  check('the refresh token is rotated', newRefresh?.value !== refresh?.value);

  // ---------------------------------------------------------------------------------------
  // Authenticated surface.
  // ---------------------------------------------------------------------------------------
  const authedJar = { ...jar, ...rotated };
  // `setAuthCookies` re-issues the CSRF cookie on every rotation, so the header must carry the
  // token from the LATEST response. Sending the previous one is a genuine mismatch and the guard
  // is right to refuse it — which is itself worth pinning.
  const currentCsrf = (rotated['XSRF-TOKEN'] ?? rotated['__Host-XSRF-TOKEN'] ?? csrf).value;

  const staleCsrf = await inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { cookie: cookieHeader(authedJar), 'x-xsrf-token': csrf.value },
  });
  check(
    'a CSRF token that no longer matches the cookie is refused',
    staleCsrf.statusCode === 403,
    String(staleCsrf.statusCode),
  );
  const profile = await inject({
    method: 'GET',
    url: '/api/v1/users/profile',
    headers: { cookie: cookieHeader(authedJar) },
  });
  check('an authenticated request is served', profile.statusCode === 200);
  check(
    'the profile never carries a password hash or a TOTP secret',
    !/passwordHash|twoFactorSecret|backupCodes|invitationToken/.test(profile.body),
  );

  const anonymous = await inject({ method: 'GET', url: '/api/v1/users/profile' });
  check('an unauthenticated request is refused', anonymous.statusCode === 401);

  const sessions = await inject({
    method: 'GET',
    url: '/api/v1/auth/sessions',
    headers: { cookie: cookieHeader(authedJar) },
  });
  const sessionRows = sessions.json<Array<{ isCurrent: boolean; ipAddress: string | null }>>();
  check('the active-session list is served', sessions.statusCode === 200);
  check('the caller can tell which device they are on', sessionRows.some((s) => s.isCurrent));
  check(
    'no full IP address is exposed',
    sessionRows.every((s) => !s.ipAddress || s.ipAddress.includes('*')),
  );

  // A sensitive action needs a fresh proof of identity, not merely a live session.
  const withoutStepUp = await inject({
    method: 'POST',
    url: '/api/v1/auth/2fa/disable',
    headers: { cookie: cookieHeader(authedJar), 'x-xsrf-token': currentCsrf },
  });
  check(
    'a step-up-guarded action is refused without a step-up proof',
    withoutStepUp.statusCode === 401,
    String(withoutStepUp.statusCode),
  );

  // ---------------------------------------------------------------------------------------
  // Sign out.
  // ---------------------------------------------------------------------------------------
  const logout = await inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { cookie: cookieHeader(authedJar), 'x-xsrf-token': currentCsrf },
  });
  check('signing out succeeds', logout.statusCode === 200, String(logout.statusCode));

  const afterLogout = await inject({
    method: 'GET',
    url: '/api/v1/users/profile',
    headers: { cookie: cookieHeader(authedJar) },
  });
  // The denylist lives in the shared cache. With a per-process cache this passed locally and
  // failed in production the moment a second replica existed.
  check(
    'the access token stops working the moment the session is revoked',
    afterLogout.statusCode === 401,
    String(afterLogout.statusCode),
  );

  console.log(
    failures.length
      ? `\nFAILURES:\n${failures.map((f) => `  - ${f}`).join('\n')}`
      : '\nTHE AUTHENTICATION SURFACE BEHAVES AS SPECIFIED',
  );
  await app.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
