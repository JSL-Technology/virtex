/**
 * Executable proof that collections is on every plan, that the session says what the plan
 * includes, and that a reminder goes only to the customer — over real HTTP, against a real
 * Postgres, for a company on the entry plan (SP-11: TES-13, TES-20, TES-21, IA-01, IA-02).
 *
 * ## What this exists to stop from happening again
 *
 * The whole collections controller sat behind the AI feature `ai_collections`, so a company on the
 * Starter plan could not see who owed it money, log a call or send a reminder it wrote itself: every
 * route answered 403. Nothing ever sent a reminder on its own, on any plan. The address a reminder
 * went to was whatever the person typed. And the client offered every screen to every plan, because
 * the session never said what the plan included: each AI page answered 403 when opened.
 *
 * This provisions a Starter company through the payment-first path, signs in, and asks the API —
 * then runs the reminder schedule for that company and asks the database what it recorded. Mail
 * goes to the development outbox (no `MAIL_HOST`); no external effect.
 *
 *     npm run verify:collections
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
import { I18nService } from '../../apps/backend/api/src/app/i18n/i18n.service';
import { localizedValidationExceptionFactory } from '../../apps/backend/api/src/app/i18n/validation-messages';
import {
  PendingRegistration,
  PendingRegistrationStatus,
} from '../../apps/backend/api/src/app/auth/entities/pending-registration.entity';
import { AutomaticRemindersService } from '../../apps/backend/api/src/app/collections/automatic-reminders.service';
import { runAsTenantJob } from '../../apps/backend/api/src/app/shared/tenancy/tenant-job';
import { organizationToday } from '../../apps/backend/api/src/app/organizations/contracts/fiscal-today.contract';
import { purgeProbeAccounts } from './probe-cleanup';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

/** A Dominican RNC with its DGII check digit (the probe needs a valid, unused one). */
function dominicanRnc(prefix: string): string {
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  const base = prefix.padStart(8, '0').slice(0, 8);
  const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const remainder = sum % 11;
  const digit = remainder === 0 ? 2 : remainder === 1 ? 1 : 11 - remainder;
  return `${base}${digit}`;
}

function cookiesOf(raw: string | string[] | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return jar;
}

/** `YYYY-MM-DD`, `days` from `today`. */
function shift(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function main() {
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
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const server = app.getHttpAdapter().getInstance();
  const ds = app.get(DataSource);

  // One source address per run: the login throttler is real (see `auth-http-contract.ts`).
  const stamp = Date.now();
  const remoteAddress = `127.${(stamp >> 16) & 0xff}.${(stamp >> 8) & 0xff}.${stamp & 0xff}`;

  await purgeProbeAccounts(ds);

  // ── A Starter company, through the path a paid signup takes ──────────────────────────────
  const email = `qa-cobranza-${stamp}@example.test`;
  const password = 'QaCobranza!2026';
  const region = await app.get(LocalizationService).findRegionByCountryCode('DO');
  if (!region) throw new Error('No hay región fiscal DO sembrada.');
  const pendingRepo = ds.getRepository(PendingRegistration);
  const pending = await pendingRepo.save(
    pendingRepo.create({
      email,
      firstName: 'QA',
      lastName: 'Cobranza',
      phone: null,
      phoneVerified: false,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      organizationName: `QA-COBRANZA ${stamp}`,
      taxId: dominicanRnc(String(13200000 + (stamp % 700000))),
      taxpayerKind: 'company',
      fiscalProfile: {},
      fiscalRegionId: region.id,
      industry: 'technology',
      companySize: '1-10',
      address: 'Calle QA 1',
      city: 'Santo Domingo',
      state: '32',
      postalCode: '10101',
      countryCode: 'DO',
      planSlug: 'starter',
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
  check('a Starter company is provisioned', Boolean(organizationId), organizationId);

  const login = await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress });
  check('its owner signs in', login.statusCode === 200, String(login.statusCode));
  const jar = cookiesOf(login.headers['set-cookie'] as string[] | undefined);
  const csrf = jar['XSRF-TOKEN'] ?? jar['__Host-XSRF-TOKEN'];
  const cookie = Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
    server.inject({ method, url, payload, remoteAddress, headers: { cookie, 'x-xsrf-token': csrf } });

  // ── The session says what the plan includes (IA-01, IA-02) ───────────────────────────────
  const session = await call('GET', '/api/v1/auth/session');
  const features = (JSON.parse(session.body) as { user?: { organization?: { features?: string[] } } }).user?.organization?.features;
  check('the session states what the Starter plan includes: photo reading, nothing else', JSON.stringify(features) === '["ai_vision"]', JSON.stringify(features));

  // A screen behind a feature the plan lacks is refused with the feature's name, not its identifier.
  const anomalies = await call('GET', '/api/v1/ai/anomalies');
  const refusal = JSON.parse(anomalies.body) as { messageKey?: string; params?: { feature?: string[] } };
  check(
    'a feature the plan lacks is refused, naming the feature by its catalogue key',
    anomalies.statusCode === 403 && refusal.messageKey === 'saas.feature_disabled' && refusal.params?.feature?.[0] === 'saas.features.ai_anomalies',
    `${anomalies.statusCode} ${anomalies.body.slice(0, 160)}`,
  );

  // ── Collections on the entry plan (TES-13, TES-20) ───────────────────────────────────────
  const today = await runAsTenantJob(ds, organizationId, () => organizationToday(ds.manager, organizationId));
  const customerEmail = `cliente-${stamp}@example.test`;
  // Fixtures and reads in the company's tenant context: under the application's role the
  // row-level policies refuse anything else, which is the point of them.
  const asTenant = <T>(work: () => Promise<T>) => runAsTenantJob(ds, organizationId, work);
  const [customer] = await asTenant(() => ds.query(
    `INSERT INTO customers (organization_id, "companyName", email, status) VALUES ($1, 'QA Cliente', $2, 'ACTIVE') RETURNING id`,
    // A QA fixture: the subject here is collections, not issuing (that is `verify:invoicing`).
    [organizationId, customerEmail],
  ));
  const openInvoice = async (daysOverdue: number): Promise<string> => {
    const [row] = await asTenant(() => ds.query(
      `INSERT INTO invoices (organization_id, customer_id, "customerName", "invoiceNumber", "issueDate", "dueDate", status, type,
                             currency_code, exchange_rate, subtotal, tax, total, net_receivable, balance, total_in_base_currency, version)
       VALUES ($1, $2, 'QA Cliente', $3, $4, $5, 'Pending', 'INVOICE', 'DOP', 1, 1000, 0, 1000, 1000, 600, 1000, 1) RETURNING id`,
      [organizationId, customer.id, `QA-${stamp}-${daysOverdue}`, shift(today, -daysOverdue - 30), shift(today, -daysOverdue)],
    ));
    return row.id;
  };
  // Two days late: inside the 1-day step's window once the schedule is on (below).
  const late = await openInvoice(2);

  const worklist = await call('GET', '/api/v1/collections/worklist');
  const list = JSON.parse(worklist.body) as { items?: Array<{ invoiceId: string; addresses: string[] }> };
  const listed = list.items?.find((item) => item.invoiceId === late);
  check('the Starter company sees its collections worklist (was 403)', worklist.statusCode === 200 && Boolean(listed), String(worklist.statusCode));
  check('the worklist offers exactly the customer’s addresses', JSON.stringify(listed?.addresses) === JSON.stringify([customerEmail]), JSON.stringify(listed?.addresses));

  const compose = await call('POST', `/api/v1/collections/invoices/${late}/reminder/compose`, { tone: 'formal' });
  const composeBody = JSON.parse(compose.body) as { messageKey?: string; params?: { feature?: string[] } };
  check(
    'the assistant’s note is the one part behind the AI feature',
    compose.statusCode === 403 && composeBody.params?.feature?.[0] === 'saas.features.ai_collections',
    `${compose.statusCode} ${composeBody.messageKey}`,
  );

  // ── A reminder goes only to the customer (TES-21) ────────────────────────────────────────
  const elsewhere = await call('POST', `/api/v1/collections/invoices/${late}/reminder/send`, { to: 'cualquiera@otro.test' });
  check(
    'a reminder to an address that is not the customer’s is refused',
    elsewhere.statusCode === 400 && (JSON.parse(elsewhere.body) as { messageKey?: string }).messageKey === 'collections.recipient_not_on_customer',
    `${elsewhere.statusCode} ${elsewhere.body.slice(0, 120)}`,
  );
  const sent = await call('POST', `/api/v1/collections/invoices/${late}/reminder/send`, { message: 'QA: recordatorio manual' });
  check('a reminder the person writes is sent to the customer, on the entry plan', sent.statusCode === 202 && JSON.parse(sent.body).to === customerEmail, `${sent.statusCode} ${sent.body.slice(0, 120)}`);

  // ── The schedule (TES-13) ────────────────────────────────────────────────────────────────
  const initial = await call('GET', '/api/v1/organizations/settings/collections');
  check(
    'the schedule starts off, with the default days',
    JSON.stringify(JSON.parse(initial.body).fields) === JSON.stringify({ collectionsAutomaticReminders: false, collectionsReminderDays: [-3, 1, 7, 15, 30] }),
    initial.body.slice(0, 160),
  );
  const saved = await call('PATCH', '/api/v1/organizations/settings/collections', {
    fields: { collectionsAutomaticReminders: true, collectionsReminderDays: [30, 1, 1, -3] },
  });
  check(
    'the company turns it on; the days are kept whole, distinct and in order',
    saved.statusCode === 200 && JSON.stringify(JSON.parse(saved.body).fields.collectionsReminderDays) === '[-3,1,30]',
    `${saved.statusCode} ${saved.body.slice(0, 160)}`,
  );
  const tooLate = await call('PATCH', '/api/v1/organizations/settings/collections', { fields: { collectionsReminderDays: [999] } });
  check(
    'a day out of bounds is refused with its rule',
    tooLate.statusCode === 400 && (JSON.parse(tooLate.body) as { messageKey?: string }).messageKey === 'organizations.settings.reminder_days_range',
    `${tooLate.statusCode} ${tooLate.body.slice(0, 120)}`,
  );

  const dayAfter = await openInvoice(1);
  const reminders = app.get(AutomaticRemindersService);
  const first = await runAsTenantJob(ds, organizationId, () => reminders.run(organizationId, today));
  const [step] = await asTenant(() =>
    ds.query(`SELECT schedule_step, recipient, user_id FROM collection_activities WHERE invoice_id = $1 AND schedule_step IS NOT NULL`, [dayAfter]),
  );
  check(
    'the schedule sends the invoice its step, from nobody, to the customer',
    first.sent >= 1 && step?.schedule_step === 1 && step?.recipient === customerEmail && step?.user_id === null,
    JSON.stringify({ first, step }),
  );
  // The invoice two days late is at the 1-day step too, but a person reminded it today: the
  // schedule waits rather than repeat it the same day.
  const [lateSteps] = await asTenant(() =>
    ds.query(`SELECT count(*)::int AS n FROM collection_activities WHERE invoice_id = $1 AND schedule_step IS NOT NULL`, [late]),
  );
  check('a person’s reminder today holds the schedule off that invoice', lateSteps.n === 0 && first.postponed >= 1, `${lateSteps.n} steps, ${first.postponed} postponed`);
  const again = await runAsTenantJob(ds, organizationId, () => reminders.run(organizationId, today));
  check('a second run the same day sends nothing new', again.sent === 0, JSON.stringify(again));

  await app.close();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nCollections, plan features and the reminder schedule: all checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
