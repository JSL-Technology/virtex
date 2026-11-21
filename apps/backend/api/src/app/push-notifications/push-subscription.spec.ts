import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isTrustedPushEndpoint } from './push-endpoint';
import { SubscribePushDto } from './dto/push-subscription.dto';
import { PushNotificationsController } from './push-notifications.controller';
import { PushSubscription } from './entities/push-subscription.entity';
import { describeWithDb, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * PLT-NOT-01 (audit 2026-11-07): `POST /push/subscribe` had no DTO, so the whitelist did not apply;
 * `create({ ...body })` + `save()` treated a body `id` as "update that row" and one user took over
 * another's subscription; and the endpoint — which the server POSTs to on every notification — was
 * any URL at all.
 */
const FCM = 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH-test-endpoint';
const KEYS = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};

// The application's global pipe, with the options main.ts installs.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: SubscribePushDto });

describe('push endpoint policy', () => {
  it.each([
    FCM,
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://db5p.notify.windows.com/w/?token=abc',
  ])('accepts a browser push service: %s', (url) => expect(isTrustedPushEndpoint(url)).toBe(true));

  it.each([
    'http://fcm.googleapis.com/fcm/send/x', // not https
    'https://169.254.169.254/latest/meta-data/', // cloud metadata
    'https://localhost:3000/api/v1/admin',
    'https://fcm.googleapis.com.evil.example/x', // suffix trick
    'https://user:pass@fcm.googleapis.com/x', // credentials
    'https://fcm.googleapis.com:8443/x', // other port
    'https://evil.notify.windows.com.example/x',
    'javascript:alert(1)',
    `https://fcm.googleapis.com/${'a'.repeat(2100)}`,
  ])('refuses anything else: %s', (url) => expect(isTrustedPushEndpoint(url)).toBe(false));
});

describe('subscribe DTO', () => {
  it('accepts exactly what PushSubscription.toJSON() sends', async () => {
    await expect(validate({ endpoint: FCM, expirationTime: null, keys: KEYS })).resolves.toBeInstanceOf(SubscribePushDto);
  });

  it('rejects an id, a userId, or an endpoint that is not a push service', async () => {
    await expect(validate({ id: '00000000-0000-4000-8000-000000000001', endpoint: FCM, keys: KEYS })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ userId: 'someone', endpoint: FCM, keys: KEYS })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ endpoint: 'https://169.254.169.254/', keys: KEYS })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ endpoint: FCM, keys: { p256dh: 'not base64url!', auth: KEYS.auth } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ endpoint: FCM })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describeWithDb('push subscriptions in the database', () => {
  let ds: DataSource;
  let controller: PushNotificationsController;
  const users: string[] = [];

  const user = async () => {
    const [{ id }] = await ds.query(`SELECT gen_random_uuid() AS id`);
    await ds.query(`INSERT INTO users (id, email, "firstName", "lastName", status) VALUES ($1, $2, 'QA', 'Push', 'ACTIVE')`, [id, `qa-push-${id}@virtex.test`]);
    users.push(id);
    return { id } as never;
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    controller = new PushNotificationsController(ds.getRepository(PushSubscription));
  });

  afterAll(async () => {
    if (users.length) await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [users]);
    await ds.destroy();
  });

  it('one row per endpoint, owned by whoever last subscribed that browser; nobody else is touched', async () => {
    const alice = await user();
    const bob = await user();
    const aliceEndpoint = `${FCM}-alice-${Date.now()}`;
    const bobEndpoint = `${FCM}-bob-${Date.now()}`;

    await controller.subscribe({ endpoint: aliceEndpoint, keys: KEYS } as SubscribePushDto, alice);
    await controller.subscribe({ endpoint: bobEndpoint, keys: KEYS } as SubscribePushDto, bob);
    await controller.subscribe({ endpoint: bobEndpoint, keys: KEYS } as SubscribePushDto, bob); // re-subscribe: still one row

    const rows: Array<{ endpoint: string; userId: string }> = await ds.query(
      `SELECT endpoint, "userId" FROM push_subscription WHERE "userId" = ANY($1) ORDER BY endpoint`,
      [users],
    );
    expect(rows).toEqual([
      { endpoint: aliceEndpoint, userId: (alice as { id: string }).id },
      { endpoint: bobEndpoint, userId: (bob as { id: string }).id },
    ]);

    // Bob cannot remove Alice's subscription by naming her endpoint.
    await controller.unsubscribe({ endpoint: aliceEndpoint }, bob);
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM push_subscription WHERE endpoint = $1`, [aliceEndpoint]);
    expect(n).toBe(1);
  });

  it('the database refuses a second row for the same endpoint', async () => {
    const carol = await user();
    const endpoint = `${FCM}-unique-${Date.now()}`;
    await controller.subscribe({ endpoint, keys: KEYS } as SubscribePushDto, carol);
    await expect(
      ds.query(`INSERT INTO push_subscription (endpoint, p256dh, auth, "userId") VALUES ($1, 'x', 'y', $2)`, [endpoint, (carol as { id: string }).id]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
