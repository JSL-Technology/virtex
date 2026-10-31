import { createHmac } from 'node:crypto';
import { BillingIntentStatus } from '../entities/billing-payment-intent.entity';
import { requestHash, responseHashValid } from '../azul/azul';

// The plans read their DOP amounts from the environment when the config module loads.
for (const slug of ['starter', 'pro', 'enterprise']) process.env[`SAAS_PRICE_${slug.toUpperCase()}_DOP`] = '150000';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AzulPaymentAdapter } = require('./azul-payment.adapter') as typeof import('./azul-payment.adapter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SAAS_PLANS } = require('../../saas/saas.config') as typeof import('../../saas/saas.config');

const AUTH_KEY = 'test-auth-key';
const config = (over: Record<string, string> = {}) => ({
  get: (k: string) =>
    ({
      AZUL_MERCHANT_ID: '39038540035',
      AZUL_MERCHANT_NAME: 'VIRTEEX',
      AZUL_AUTH_KEY: AUTH_KEY,
      PUBLIC_API_URL: 'https://app.virteex.do/api/v1',
      ...over,
    })[k],
});

function signResponse(q: Record<string, string>): Record<string, string> {
  const order = ['OrderNumber', 'Amount', 'AuthorizationCode', 'DateTime', 'ResponseCode', 'IsoCode', 'ResponseMessage', 'ErrorDescription', 'RRN'];
  const hash = createHmac('sha512', AUTH_KEY).update(order.map((k) => q[k] ?? '').join('') + AUTH_KEY).digest('hex');
  return { ...q, AuthHash: hash };
}

describe('Azul', () => {
  const plan = SAAS_PLANS[0];
  let saved: Record<string, any>;


  const make = () => {
    saved = {};
    const intents: any = {
      create: (v: any) => ({ id: '11111111-1111-4111-8111-111111111111', createdAt: new Date(), ...v }),
      save: jest.fn(async (v: any) => {
        saved[v.id] = v;
        return v;
      }),
      findOne: jest.fn(async ({ where }: any) => saved[where.id] ?? null),
      find: jest.fn(async () => []),
    };
    const events: any = { emitAsync: jest.fn(async () => []) };
    const adapter = new AzulPaymentAdapter({} as never, intents, {} as never, events, config() as never);
    return { adapter, intents, events };
  };

  it('prices a plan in DOP and adds the ITBIS on top', () => {
    const { adapter } = make();
    expect(adapter.charge(plan.slug, 'monthly')).toEqual({ amountMinor: 177000, taxMinor: 27000 });
    expect(adapter.priceIdFor({ slug: plan.slug }, 'monthly')).toBe(`azul_price_${plan.slug}_monthly`);
  });

  it('signs the Payment Page request and sends the buyer there', async () => {
    const { adapter } = make();
    const session = await adapter.createRegistrationCheckoutSession({
      email: 'ana@example.com', priceId: `azul_price_${plan.slug}_monthly`, planSlug: plan.slug,
      successUrl: 'https://app.virteex.do/register/done?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app.virteex.do/register', metadata: { pendingRegistrationId: 'pr-1' },
    });
    expect(session.url).toBe(`https://app.virteex.do/api/v1/payment/azul/pay/${session.sessionId}`);
    const html = await adapter.paymentPage(session.sessionId);
    expect(html).toContain('action="https://pruebas.azul.com.do/PaymentPage/"');
    expect(html).toContain('name="Amount" value="177000"');
    expect(html).toContain('name="ITBIS" value="27000"');
    expect(html).toContain('name="SaveToDataVault" value="1"');
    const hash = /name="AuthHash" value="([0-9a-f]+)"/.exec(html)?.[1];
    expect(hash).toHaveLength(128);
  });

  it('an authentic approval completes the checkout, keeps the card token and materialises the signup', async () => {
    const { adapter, events } = make();
    const { sessionId } = await adapter.createRegistrationCheckoutSession({
      email: 'ana@example.com', priceId: `azul_price_${plan.slug}_monthly`, planSlug: plan.slug,
      successUrl: 'https://app.virteex.do/done?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'https://app.virteex.do/x',
      metadata: { pendingRegistrationId: 'pr-1' },
    });
    const order = saved[sessionId].orderNumber;
    const next = await adapter.completeReturn(sessionId, 'approved', signResponse({
      OrderNumber: order, Amount: '177000', AuthorizationCode: 'OK1234', DateTime: '20261031101010',
      ResponseCode: 'ISO8583', IsoCode: '00', ResponseMessage: 'APROBADA', ErrorDescription: '', RRN: '123456',
      AzulOrderId: '987', DataVaultToken: 'TOKEN-1', DataVaultBrand: 'VISA', CardNumber: '411111******1111',
    }));
    expect(next).toBe(`https://app.virteex.do/done?session_id=${sessionId}`);
    expect(saved[sessionId].status).toBe(BillingIntentStatus.APPROVED);
    expect(saved[sessionId].cardToken).toBe('TOKEN-1');
    expect(saved[sessionId].cardLast4).toBe('1111');
    expect(JSON.stringify(saved[sessionId].response)).not.toContain('TOKEN-1');
    expect(events.emitAsync).toHaveBeenCalledWith('registration.payment_completed', expect.objectContaining({ pendingRegistrationId: 'pr-1' }));
    const info = await adapter.getCheckoutSession(sessionId);
    expect(info).toMatchObject({ status: 'complete', paymentStatus: 'paid', subscriptionId: `azul_sub_${sessionId}`, subscriptionStatus: 'active' });
  });

  it('refuses a return whose hash does not verify, or that names another amount', async () => {
    const { adapter } = make();
    const { sessionId } = await adapter.createRegistrationCheckoutSession({
      email: 'a@b.c', priceId: `azul_price_${plan.slug}_monthly`, planSlug: plan.slug,
      successUrl: 'https://x.do/ok', cancelUrl: 'https://x.do/no', metadata: { pendingRegistrationId: 'pr-2' },
    });
    const order = saved[sessionId].orderNumber;
    const tampered = { ...signResponse({ OrderNumber: order, Amount: '177000', IsoCode: '00' }), IsoCode: '00', AuthorizationCode: 'FORGED' };
    await expect(adapter.completeReturn(sessionId, 'approved', tampered)).rejects.toThrow();
    await expect(
      adapter.completeReturn(sessionId, 'approved', signResponse({ OrderNumber: order, Amount: '100', IsoCode: '00' })),
    ).rejects.toThrow();
    expect(saved[sessionId].status).toBe(BillingIntentStatus.PENDING);
  });

  it('a decline is recorded and the buyer goes back to the checkout', async () => {
    const { adapter, events } = make();
    const { sessionId } = await adapter.createRegistrationCheckoutSession({
      email: 'a@b.c', priceId: `azul_price_${plan.slug}_monthly`, planSlug: plan.slug,
      successUrl: 'https://x.do/ok', cancelUrl: 'https://x.do/no', metadata: { pendingRegistrationId: 'pr-3' },
    });
    const order = saved[sessionId].orderNumber;
    const next = await adapter.completeReturn(sessionId, 'declined', signResponse({ OrderNumber: order, Amount: '177000', IsoCode: '51', ResponseMessage: 'DECLINADA' }));
    expect(next).toBe('https://x.do/no');
    expect(saved[sessionId].status).toBe(BillingIntentStatus.DECLINED);
    expect(events.emitAsync).not.toHaveBeenCalled();
  });

  it('the hash helpers agree with each other and reject garbage', () => {
    expect(requestHash({} as never, 'k')).toHaveLength(128);
    expect(responseHashValid({ AuthHash: 'nope' }, 'k')).toBe(false);
    expect(AzulPaymentAdapter.orderNumber()).toMatch(/^VX[0-9A-Z]{1,13}$/);
    expect(AzulPaymentAdapter.orderNumber().length).toBeLessThanOrEqual(15);
  });
});
