import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';
import { XeRatesProvider } from './xe-rates.provider';

/**
 * The XE contract, pinned.
 *
 * The previous client could not be tested without a repository, a scheduler lock and a Nest module,
 * so it never was — and it was wrong in two ways that only a live call would have shown: it asked
 * for `/v1/rates/historical.json`, an endpoint the XE Currency Data API does not publish, and it
 * parsed `to` as a map of code → number when XE returns an array of `{ quotecurrency, mid }`.
 * Either alone means the refresh stores nothing, and it stores nothing quietly: the cron handler
 * logs and swallows, so an empty `exchange_rates` table looks exactly like a tenant that has not
 * configured rates yet.
 *
 * These tests are the part that must hold without a network.
 */
describe('XeRatesProvider', () => {
  const config = (values: Record<string, string | undefined>) =>
    ({ get: (key: string) => values[key] }) as never;

  const http = (payload: unknown) => {
    const get = jest.fn().mockReturnValue(of({ data: payload } as AxiosResponse));
    return { service: { get } as never, get };
  };

  const credentials = {
    XE_API_ID: 'account-id',
    XE_API_KEY: 'account-key',
  };

  describe('the request', () => {
    it('calls historic_rate.json — the endpoint XE actually publishes', async () => {
      const { service, get } = http({ to: [] });
      const provider = new XeRatesProvider(service, config(credentials));

      await provider.fetchMidRates('USD', ['DOP'], '2026-09-05');

      const [url] = get.mock.calls[0];
      expect(url).toContain('/historic_rate.json');
      expect(url).not.toContain('/rates/historical');
    });

    it('asks for amount=1, so `mid` is the rate and not a converted amount', async () => {
      const { service, get } = http({ to: [] });
      const provider = new XeRatesProvider(service, config(credentials));

      await provider.fetchMidRates('USD', ['DOP'], '2026-09-05');

      expect(get.mock.calls[0][0]).toContain('amount=1');
      expect(get.mock.calls[0][0]).toContain('date=2026-09-05');
      expect(get.mock.calls[0][0]).toContain('from=USD');
    });

    it('authenticates with the API id as the user and the key as the password', async () => {
      const { service, get } = http({ to: [] });
      const provider = new XeRatesProvider(service, config(credentials));

      await provider.fetchMidRates('USD', ['DOP'], '2026-09-05');

      const header = get.mock.calls[0][1].headers.Authorization as string;
      expect(header.startsWith('Basic ')).toBe(true);
      expect(Buffer.from(header.slice(6), 'base64').toString()).toBe('account-id:account-key');
    });

    /** XE caps the `to` list; a whole currency catalogue in one request is silently truncated. */
    it('chunks a long currency list across requests', async () => {
      const { service, get } = http({ to: [] });
      const provider = new XeRatesProvider(service, config(credentials));
      const many = Array.from({ length: 120 }, (_, i) => `C${String(i).padStart(2, '0')}`);

      await provider.fetchMidRates('USD', many, '2026-09-05');

      expect(get).toHaveBeenCalledTimes(3);
    });

    it('refuses to call at all without credentials', async () => {
      const { service } = http({ to: [] });
      const provider = new XeRatesProvider(service, config({}));

      await expect(provider.fetchMidRates('USD', ['DOP'], '2026-09-05')).rejects.toThrow();
      expect(provider.isConfigured()).toBe(false);
    });
  });

  describe('the response', () => {
    it("reads XE's documented array shape", async () => {
      const { service } = http({
        from: 'USD',
        to: [
          { quotecurrency: 'DOP', mid: 60.512345 },
          { quotecurrency: 'EUR', mid: 0.921 },
        ],
      });
      const provider = new XeRatesProvider(service, config(credentials));

      await expect(provider.fetchMidRates('USD', ['DOP', 'EUR'], '2026-09-05')).resolves.toEqual([
        { currency: 'DOP', rate: 60.512345 },
        { currency: 'EUR', rate: 0.921 },
      ]);
    });

    /** Tolerated, because degrading to a log line beats degrading to an empty ledger. */
    it('also reads a map shape', async () => {
      const { service } = http({ to: { DOP: 60.5, EUR: 0.92 } });
      const provider = new XeRatesProvider(service, config(credentials));

      await expect(provider.fetchMidRates('USD', ['DOP', 'EUR'], '2026-09-05')).resolves.toEqual([
        { currency: 'DOP', rate: 60.5 },
        { currency: 'EUR', rate: 0.92 },
      ]);
    });

    /**
     * A thin pair legitimately has no quote on some days. Storing the zero would make every
     * conversion through that pair produce nothing, silently — which is worse than having no rate,
     * because the resolver would find one and use it.
     */
    it('drops a null, zero or non-numeric quote instead of storing it', async () => {
      const { service } = http({
        to: [
          { quotecurrency: 'DOP', mid: 60.5 },
          { quotecurrency: 'PYG', mid: 0 },
          { quotecurrency: 'VES', mid: null },
          { quotecurrency: 'ARS', mid: 'n/a' },
        ],
      });
      const provider = new XeRatesProvider(service, config(credentials));

      await expect(provider.fetchMidRates('USD', ['DOP'], '2026-09-05')).resolves.toEqual([
        { currency: 'DOP', rate: 60.5 },
      ]);
    });

    it('returns nothing rather than throwing when `to` is absent', async () => {
      const { service } = http({ from: 'USD' });
      const provider = new XeRatesProvider(service, config(credentials));

      await expect(provider.fetchMidRates('USD', ['DOP'], '2026-09-05')).resolves.toEqual([]);
    });
  });

  describe('the account plan', () => {
    /**
     * The check that keeps fabricated numbers out of the books: XE serves mock rates on the free
     * trial, and a mock rate is indistinguishable from a real one once it is stored.
     */
    it('reports the free trial as serving mock rates', async () => {
      const { service } = http({ package: 'Freetrial Daily', package_limit_remaining: 4999 });
      const provider = new XeRatesProvider(service, config(credentials));

      await expect(provider.accountInfo()).resolves.toEqual({
        package: 'Freetrial Daily',
        remaining: 4999,
        servesMockRates: true,
      });
    });

    it('reports a paid plan as serving real rates', async () => {
      const { service } = http({ package: 'Prime', package_limit_remaining: 100000 });
      const provider = new XeRatesProvider(service, config(credentials));

      await expect(provider.accountInfo()).resolves.toMatchObject({ servesMockRates: false });
    });
  });

  describe('failures', () => {
    it('never puts the credentials in the error it raises', async () => {
      const get = jest.fn().mockReturnValue(
        throwError(() => ({
          message: 'Request failed',
          response: { status: 401, data: { message: 'Unauthorized' } },
        })),
      );
      const provider = new XeRatesProvider({ get } as never, config(credentials));

      await expect(
        provider.fetchMidRates('USD', ['DOP'], '2026-09-05'),
      ).rejects.toMatchObject({ messageKey: 'CURRENCIES.PROVEEDOR_TASAS_ERROR' });
    });
  });
});
