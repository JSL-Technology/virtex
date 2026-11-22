import { DateTime } from 'luxon';
import { allMarkets, OFFICIAL_RATE_FEEDS, OfficialRateFormatError, officialRateFeed } from '.';
import { positiveRate, uniqueQuotes } from './kit/official-rates';

/**
 * Each market's official-rate feed reads its publisher's document strictly (FINB-03).
 *
 * The documents here are in the shape each publisher documents. Every feed's format was established
 * from that documentation, which is why a feed starts in shadow: these tests pin what the parser
 * reads, and the first live readings — compared, not written — show whether the publisher answers in
 * that shape. What must never happen is a figure guessed out of an answer the parser does not
 * recognise; every refusal below is that.
 */
const feed = (code: string) => {
  const registered = officialRateFeed(code);
  if (!registered) throw new Error(`no feed ${code}`);
  return registered.feed;
};
const refuses = (code: string, body: string, reason: RegExp) => {
  let caught: unknown;
  try {
    feed(code).parse(body);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(OfficialRateFormatError);
  expect((caught as OfficialRateFormatError).reason).toMatch(reason);
};
const MARCH = { from: '2026-03-01', to: '2026-03-31' };

describe('official-rate feeds', () => {
  describe('every market that declares an official rate', () => {
    const declaring = allMarkets().filter((market) => market.accounting.officialExchangeRates);

    it('quotes it in its own currency', () => {
      for (const market of declaring) {
        expect([market.code, market.accounting.officialExchangeRates?.quoteCurrency]).toEqual([market.code, market.profile.currency]);
      }
    });

    it('names a feed only of its own country, under a unique code, that never quotes the market currency against itself', () => {
      const codes = new Set<string>();
      for (const market of declaring) {
        const official = market.accounting.officialExchangeRates!;
        if (!official.feed) continue;
        expect(official.feed.country).toBe(market.code);
        expect(official.feed.code.startsWith(`${market.code}-`)).toBe(true);
        expect(codes.has(official.feed.code)).toBe(false);
        codes.add(official.feed.code);
        expect(official.feed.currencies).not.toContain(official.quoteCurrency);
        expect(official.feed.code.length).toBeLessThanOrEqual(32); // `exchange_rate.source` is varchar(32)
      }
      expect([...OFFICIAL_RATE_FEEDS.keys()].sort()).toEqual([...codes].sort());
    });

    it('publishes in a real time zone, at a real time, and dates no further ahead than a week', () => {
      for (const { feed: definition } of OFFICIAL_RATE_FEEDS.values()) {
        expect(DateTime.now().setZone(definition.publishedAfter.timeZone).isValid).toBe(true);
        expect(definition.publishedAfter.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        expect(definition.datesAhead).toBeGreaterThanOrEqual(0);
        expect(definition.datesAhead).toBeLessThanOrEqual(7);
      }
    });

    it('starts in shadow: every format was established from the publisher\'s documentation', () => {
      for (const { feed: definition } of OFFICIAL_RATE_FEEDS.values()) expect(definition.formatEstablishedFrom).toBe('documentation');
    });
  });

  describe('reading a figure', () => {
    it('takes a number or a numeric string, with a thousands comma only where one goes', () => {
      expect(positiveRate('T', 17.25, 'x')).toBe(17.25);
      expect(positiveRate('T', '4,093.24', 'x')).toBe(4093.24);
      expect(positiveRate('T', '1072.5', 'x')).toBe(1072.5);
    });

    it('refuses a decimal comma rather than reading «4093,24» as 409324', () => {
      expect(() => positiveRate('T', '4093,24', 'x')).toThrow(OfficialRateFormatError);
      expect(() => positiveRate('T', '4.093,24', 'x')).toThrow(OfficialRateFormatError);
      expect(() => positiveRate('T', '0', 'x')).toThrow(OfficialRateFormatError);
      expect(() => positiveRate('T', '', 'x')).toThrow(OfficialRateFormatError);
      expect(() => positiveRate('T', null, 'x')).toThrow(OfficialRateFormatError);
    });

    it('refuses a publication that states two different figures for the same day', () => {
      expect(() =>
        uniqueQuotes('T', [
          { currency: 'USD', publishedOn: '2026-03-13', rate: 1 },
          { currency: 'USD', publishedOn: '2026-03-13', rate: 2 },
        ]),
      ).toThrow(OfficialRateFormatError);
    });
  });

  describe('Colombia — TRM (datos.gov.co, Superintendencia Financiera)', () => {
    const body = JSON.stringify([
      { valor: '4093.24', unidad: 'COP', vigenciadesde: '2026-03-14T00:00:00.000', vigenciahasta: '2026-03-16T00:00:00.000' },
      { valor: '4101.10', unidad: 'COP', vigenciadesde: '2026-03-17T00:00:00.000', vigenciahasta: '2026-03-17T00:00:00.000' },
    ]);

    it('asks for the rows in force from the first day to the last, oldest first', () => {
      const { url } = feed('CO-TRM').request(MARCH, null);
      const query = new URL(url).searchParams;
      expect(url.startsWith('https://www.datos.gov.co/resource/32sa-8pi3.json?')).toBe(true);
      expect(query.get('$where')).toBe("vigenciadesde between '2026-03-01T00:00:00' and '2026-03-31T23:59:59'");
      expect(query.get('$order')).toBe('vigenciadesde');
    });

    it('dates each TRM by the first day it is in force — a Friday\'s covers the weekend', () => {
      expect(feed('CO-TRM').parse(body)).toEqual([
        { currency: 'USD', publishedOn: '2026-03-14', rate: 4093.24 },
        { currency: 'USD', publishedOn: '2026-03-17', rate: 4101.1 },
      ]);
    });

    it('refuses a row in another unit, a figure that is not one, and a body that is not the list', () => {
      refuses('CO-TRM', JSON.stringify([{ valor: '4093.24', unidad: 'USD', vigenciadesde: '2026-03-14T00:00:00.000' }]), /not COP/);
      refuses('CO-TRM', JSON.stringify([{ valor: '4093,24', unidad: 'COP', vigenciadesde: '2026-03-14T00:00:00.000' }]), /not a figure/);
      refuses('CO-TRM', JSON.stringify({ error: true, message: 'query timeout' }), /not a list/);
      refuses('CO-TRM', '<html>Service Unavailable</html>', /not JSON/);
    });
  });

  describe('Mexico — FIX published in the DOF (Banco de México SIE)', () => {
    it('asks for the series over the range, with the token in its header', () => {
      const request = feed('MX-BANXICO-FIX-DOF').request(MARCH, 'token-of-64-characters');
      expect(request.url).toBe('https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF60653/datos/2026-03-01/2026-03-31');
      expect(request.headers['Bmx-Token']).toBe('token-of-64-characters');
    });

    it('reads DD/MM/YYYY days and skips the ones with no figure', () => {
      const body = JSON.stringify({
        bmx: {
          series: [
            {
              idSerie: 'SF60653',
              titulo: 'Tipo de cambio Pesos por dólar E.U.A. Para solventar obligaciones denominadas en moneda extranjera Fecha de liquidación',
              datos: [
                { fecha: '13/03/2026', dato: '17.9876' },
                { fecha: '14/03/2026', dato: 'N/E' },
                { fecha: '17/03/2026', dato: '18.0123' },
              ],
            },
          ],
        },
      });
      expect(feed('MX-BANXICO-FIX-DOF').parse(body)).toEqual([
        { currency: 'USD', publishedOn: '2026-03-13', rate: 17.9876 },
        { currency: 'USD', publishedOn: '2026-03-17', rate: 18.0123 },
      ]);
    });

    it('is the official rate from the day after it is published (CFF art. 20)', () => {
      expect(feed('MX-BANXICO-FIX-DOF').effectiveFrom).toBe('day-after-publication');
    });

    it('answers nothing for a range with no publication, and refuses a response without the series', () => {
      expect(feed('MX-BANXICO-FIX-DOF').parse(JSON.stringify({ bmx: { series: [{ idSerie: 'SF60653', titulo: 'x' }] } }))).toEqual([]);
      refuses('MX-BANXICO-FIX-DOF', JSON.stringify({ bmx: { series: [{ idSerie: 'SF43718', datos: [] }] } }), /no series SF60653/);
      refuses('MX-BANXICO-FIX-DOF', JSON.stringify({ error: { mensaje: 'Token inválido' } }), /bmx is not an object/);
      refuses('MX-BANXICO-FIX-DOF', JSON.stringify({ bmx: { series: [{ idSerie: 'SF60653', datos: [{ fecha: '2026-03-13', dato: '17.9' }] }] } }), /DD\/MM\/YYYY/);
    });
  });

  describe('Argentina — Comunicación «A» 3500 (BCRA)', () => {
    it('asks for the dollar over the range', () => {
      expect(feed('AR-BCRA-A3500').request(MARCH, null).url).toBe(
        'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=2026-03-01&fechahasta=2026-03-31',
      );
    });

    it('reads the dollar\'s figure of each day', () => {
      const body = JSON.stringify({
        status: 200,
        metadata: { resultset: { count: 2, offset: 0, limit: 1000 } },
        results: [
          { fecha: '2026-03-13', detalle: [{ codigoMoneda: 'USD', descripcion: 'DOLAR E.E.U.U.', tipoPase: 1.0, tipoCotizacion: 1072.5 }] },
          { fecha: '2026-03-16', detalle: [{ codigoMoneda: 'USD', descripcion: 'DOLAR E.E.U.U.', tipoPase: 1.0, tipoCotizacion: 1074.25 }] },
        ],
      });
      expect(feed('AR-BCRA-A3500').parse(body)).toEqual([
        { currency: 'USD', publishedOn: '2026-03-13', rate: 1072.5 },
        { currency: 'USD', publishedOn: '2026-03-16', rate: 1074.25 },
      ]);
    });

    it('refuses an error status, and a day that quotes the dollar twice', () => {
      refuses('AR-BCRA-A3500', JSON.stringify({ status: 400, errorMessages: ['La fecha desde no puede ser mayor a la fecha hasta.'] }), /status is 400/);
      refuses(
        'AR-BCRA-A3500',
        JSON.stringify({
          status: 200,
          results: [{ fecha: '2026-03-13', detalle: [{ codigoMoneda: 'USD', tipoCotizacion: 1 }, { codigoMoneda: 'USD', tipoCotizacion: 2 }] }],
        }),
        /quotes USD twice/,
      );
    });

    it('sets no bound on the daily move: the peso has moved by more in a day than any bound would allow', () => {
      expect(feed('AR-BCRA-A3500').maxDailyChange).toBeNull();
    });
  });

  describe('Peru — SBS selling rate (BCRP statistics)', () => {
    it('asks for the series over the range', () => {
      expect(feed('PE-SBS-VENTA').request(MARCH, null).url).toBe(
        'https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04640PD/json/2026-03-01/2026-03-31',
      );
    });

    it('reads DD.Mmm.YY days in Spanish, «Set» for September too, and skips «n.d.»', () => {
      const body = JSON.stringify({
        config: { title: 'Tipo de cambio - TC Sistema bancario SBS (S/ por US$) - Venta', series: [{ name: 'Venta', dec: '3' }] },
        periods: [
          { name: '13.Mar.26', values: ['3.652'] },
          { name: '14.Mar.26', values: ['n.d.'] },
          { name: '16.Set.26', values: ['3.660'] },
        ],
      });
      expect(feed('PE-SBS-VENTA').parse(body)).toEqual([
        { currency: 'USD', publishedOn: '2026-03-13', rate: 3.652 },
        { currency: 'USD', publishedOn: '2026-09-16', rate: 3.66 },
      ]);
    });

    it('refuses a day it cannot read and a day that does not exist', () => {
      refuses('PE-SBS-VENTA', JSON.stringify({ periods: [{ name: '13.Mzo.26', values: ['3.652'] }] }), /DD\.Mmm\.YY/);
      refuses('PE-SBS-VENTA', JSON.stringify({ periods: [{ name: '31.Feb.26', values: ['3.652'] }] }), /not a calendar day/);
    });
  });

  describe('Brazil — PTAX selling rate (BCB Olinda)', () => {
    it('asks for the period with its dates as MM-DD-YYYY', () => {
      const { url } = feed('BR-BCB-PTAX-VENDA').request(MARCH, null);
      expect(url).toContain("@dataInicial='03-01-2026'&@dataFinalCotacao='03-31-2026'");
      expect(url).toContain('$format=json');
    });

    it('reads the closing PTAX of each day', () => {
      const body = JSON.stringify({
        '@odata.context': 'https://was-p.bcnet.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata$metadata#_CotacaoDolarPeriodo(cotacaoVenda,dataHoraCotacao)',
        value: [
          { cotacaoVenda: 5.7123, dataHoraCotacao: '2026-03-13 13:06:24.123' },
          { cotacaoVenda: 5.7301, dataHoraCotacao: '2026-03-16 13:03:11.457' },
        ],
      });
      expect(feed('BR-BCB-PTAX-VENDA').parse(body)).toEqual([
        { currency: 'USD', publishedOn: '2026-03-13', rate: 5.7123 },
        { currency: 'USD', publishedOn: '2026-03-16', rate: 5.7301 },
      ]);
    });

    it('refuses a response without its list', () => {
      refuses('BR-BCB-PTAX-VENDA', JSON.stringify({ error: { code: '500', message: 'Internal error' } }), /value is not a list/);
    });
  });
});
