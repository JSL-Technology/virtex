import { DataSource } from 'typeorm';
import { InboundMailService } from './inbound-mail.service';
import { InboundMailbox } from './entities/inbound-mailbox.entity';
import { InboundMessage } from './entities/inbound-message.entity';
import { InboundMailHandlerRegistry } from '../contracts/inbound-mail/inbound-mail.contract';
import { parseInboundMail } from './inbound-payload';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';
import { patchDataAccessForTenancy } from '../shared/tenancy/tenant-repository.patch';

// What TenancyModule installs in the application: repositories follow the tenant's connection.
patchDataAccessForTenancy();

/**
 * Receiving mail as the application's own role: the token in the address is the only way to the
 * company, row-level security holds everywhere else, the same message is received once, and a
 * purpose's module turns it into records that say they came by mail.
 */
const APP_PASSWORD = process.env['APP_DB_PASSWORD'];

(APP_PASSWORD ? describeWithDb : describe.skip)('InboundMailService (as virtex_app)', () => {
  let admin: DataSource;
  let app: DataSource;
  let organizationId: string;
  let service: InboundMailService;
  let token: string;
  const registry = new InboundMailHandlerRegistry();
  const queued: unknown[] = [];
  const stored = new Map<string, Buffer>();
  const handled: string[] = [];

  beforeAll(async () => {
    admin = await openTestDataSource();
    organizationId = await createTestOrganization(admin, 'inbound-mail');
    app = await new DataSource({ ...(admin.options as object), username: 'virtex_app', password: APP_PASSWORD } as never).initialize();
    const storage = {
      upload: async (file: { fileName: string; buffer: Buffer }) => {
        const key = `k-${stored.size}`;
        stored.set(key, file.buffer);
        return { storageKey: key };
      },
      getStream: async (key: string) => ({ stream: (async function* () { yield stored.get(key)!; })(), fileSize: 0, mimeType: '' }),
    };
    registry.register({
      purpose: 'BILLS',
      handle: async (message) => {
        handled.push((await message.attachments[0].read()).toString());
        return { status: 'PROCESSED', records: [{ type: 'vendor_bill', id: '11111111-1111-4111-8111-111111111111', label: 'B01', link: '/accounts-payable/x' }] };
      },
    });
    service = new InboundMailService(
      app.getRepository(InboundMailbox),
      app.getRepository(InboundMessage),
      app,
      storage as never,
      registry,
      { get: (key: string) => ({ INBOUND_MAIL_DOMAIN: 'in.virtex.test', INBOUND_MAIL_WEBHOOK_SECRET: 'x'.repeat(40) })[key] } as never,
      { add: async (_name: string, data: unknown) => queued.push(data) } as never,
    );
    // Created as an administrator would: inside the company's own tenant.
    await admin.query(`INSERT INTO inbound_mailboxes (organization_id, purpose, token, allowed_senders) VALUES ($1, 'BILLS', $2, '["@supplier.com"]')`, [
      organizationId,
      (token = 'abcdef0123456789abcdef0123456789'),
    ]);
  });

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    await dropTestOrganization(admin, organizationId);
  });

  const mail = (overrides: Record<string, unknown> = {}) =>
    parseInboundMail({
      to: [`bills+${token}@in.virtex.test`],
      from: 'Ana <ana@supplier.com>',
      subject: 'Factura',
      messageId: '<m1@supplier.com>',
      text: 'adjunta',
      attachments: [{ fileName: 'f.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF-1').toString('base64') }],
      ...overrides,
    });

  it('sees no mailbox without a tenant, but finds one by its exact token', async () => {
    expect((await app.query(`SELECT count(*)::int AS n FROM inbound_mailboxes`))[0].n).toBe(0);
    const [found] = await app.query(`SELECT * FROM inbound_mailbox_by_token($1)`, [token]);
    expect(found).toMatchObject({ organization_id: organizationId, purpose: 'BILLS' });
    expect(await app.query(`SELECT * FROM inbound_mailbox_by_token($1)`, ['nope'])).toEqual([]);
  });

  it('refuses an unknown address, a sender not on the list and a forged sender', async () => {
    expect(await service.receive(mail({ to: ['bills+ffffffffffffffffffffffffffffffff@in.virtex.test'] }))).toEqual({ accepted: false, reason: 'unknown_mailbox' });
    expect(await service.receive(mail({ from: 'x@evil.com' }))).toEqual({ accepted: false, reason: 'sender_not_allowed' });
    expect(await service.receive(mail({ authentication: { spf: 'fail' } }))).toEqual({ accepted: false, reason: 'not_authenticated' });
  });

  it('stores a message once, queues it, and hands it to its purpose', async () => {
    const first = await service.receive(mail());
    const again = await service.receive(mail());
    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(again).toMatchObject({ accepted: true, duplicate: true });
    expect(queued).toHaveLength(1);
    const messageId = (first as { messageId: string }).messageId;

    await service.process(organizationId, messageId, true);
    expect(handled).toEqual(['%PDF-1']);
    const [row] = await admin.query(`SELECT status, records FROM inbound_messages WHERE id = $1`, [messageId]);
    expect(row.status).toBe('PROCESSED');
    const [provenance] = await admin.query(`SELECT source, detail FROM ai_record_provenance WHERE organization_id = $1 AND entity_id = $2`, [
      organizationId,
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(provenance).toMatchObject({ source: 'AI_MAIL', detail: { inboundMessageId: messageId, from: 'ana@supplier.com' } });
  });
});
