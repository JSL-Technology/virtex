import { ExecutionContext } from '@nestjs/common';
import { defer, lastValueFrom, of } from 'rxjs';
import { NOTICES_HEADER, parseRequestNotices } from '@virtex/shared/types';
import { addNotice, collectNotices, RequestNotice } from './request-notices';
import { LocaleInterceptor } from './locale.interceptor';
import { I18nService } from './i18n.service';
import { runWithLanguage } from './request-locale';

/**
 * A request that succeeded with a caveat tells its reader (FINB-06): a document converted at the
 * market rate because no official one was on file used to say so only in the server's log.
 */
describe('request notices', () => {
  const fallback: RequestNotice = {
    code: 'EXCHANGE_RATE_MARKET_FALLBACK',
    messageKey: 'currencies.market_rate_used_without_official',
    messageParams: { from: 'USD', to: 'DOP', date: '2026-03-15', source: 'XE', quotedOn: '2026-03-14' },
  };

  it('outside a request there is no reader, and nothing is collected', () => {
    expect(addNotice(fallback)).toBe(false);
  });

  it('collects across everything the request awaits, and says the same thing once', async () => {
    const notices: RequestNotice[] = [];
    await collectNotices(notices, async () => {
      addNotice(fallback);
      await new Promise((resolve) => setTimeout(resolve, 1));
      // Twenty dollar lines converted at the same fallback rate are one notice, not twenty.
      for (let line = 0; line < 20; line++) addNotice(fallback);
      await Promise.all([1, 2].map(async () => addNotice({ ...fallback, messageParams: { ...fallback.messageParams, to: 'EUR' } })));
    });
    expect(notices).toHaveLength(2);
  });

  it('two requests at once keep their notices apart', async () => {
    const first: RequestNotice[] = [];
    const second: RequestNotice[] = [];
    await Promise.all([
      collectNotices(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        addNotice(fallback);
      }),
      collectNotices(second, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('a runaway loop cannot grow the header without bound', async () => {
    const notices: RequestNotice[] = [];
    await collectNotices(notices, async () => {
      for (let n = 0; n < 100; n++) addNotice({ ...fallback, messageParams: { n } });
    });
    expect(notices).toHaveLength(20);
  });

  describe('sent by the interceptor', () => {
    const interceptor = new LocaleInterceptor(new I18nService());
    // The application runs on Fastify, whose reply sets a header with `header()`; a slice under test
    // may run on Express, with `setHeader()`. The first version handled only the second, and the
    // live verifier — on Fastify — received no notice at all.
    const fastifyReply = (headers: Record<string, string>) => ({ sent: false, header: (name: string, value: string) => (headers[name] = value) });
    const expressResponse = (headers: Record<string, string>) => ({ headersSent: false, setHeader: (name: string, value: string) => (headers[name] = value) });
    type Reply = (headers: Record<string, string>) => object;
    const respond = (handler: () => unknown, headers: Record<string, string>, reply: Reply = fastifyReply) => {
      const response = reply(headers);
      const context = {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => ({ user: { preferredLanguage: 'en' } }), getResponse: () => response }),
      } as unknown as ExecutionContext;
      // The handler runs on subscription, as Nest runs it: what it notices must reach the header.
      const next = { handle: () => defer(() => of(handler())) };
      return runWithLanguage('es', () => lastValueFrom(interceptor.intercept(context, next)));
    };

    it('in a header, as keys with their parameters and the sentence in the reader\'s language', async () => {
      const headers: Record<string, string> = {};
      const body = await respond(() => {
        addNotice(fallback);
        return { id: 'entry-1' };
      }, headers);

      expect(body).toEqual({ id: 'entry-1' }); // the body is untouched
      const [notice] = parseRequestNotices(headers[NOTICES_HEADER]);
      expect(notice).toMatchObject({ code: fallback.code, messageKey: fallback.messageKey, messageParams: fallback.messageParams });
      // The reader chose English; the sentence is theirs, with every placeholder filled.
      expect(notice.message).toContain('USD');
      expect(notice.message).toContain('2026-03-14');
      expect(notice.message).not.toMatch(/\{\{/);
      expect(notice.message).not.toMatch(/No había/);
    });

    it('on Express as on Fastify', async () => {
      const headers: Record<string, string> = {};
      await respond(() => {
        addNotice(fallback);
        return {};
      }, headers, expressResponse);
      expect(parseRequestNotices(headers[NOTICES_HEADER])).toHaveLength(1);
    });

    it('no notice, no header', async () => {
      const headers: Record<string, string> = {};
      await respond(() => ({ id: 'entry-2' }), headers);
      expect(headers[NOTICES_HEADER]).toBeUndefined();
    });
  });
});
