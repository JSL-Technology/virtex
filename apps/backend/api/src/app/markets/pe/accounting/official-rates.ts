import { OfficialRateFeed, OfficialRateFormatError } from '../../contracts';
import { arrayAt, calendarDay, jsonBody, objectAt, positiveRate, uniqueQuotes } from '../../kit/official-rates';

const CODE = 'PE-SBS-VENTA';
/** BCRP: «Tipo de cambio - TC Sistema bancario SBS (S/ por US$) - Venta». */
const SERIES = 'PD04640PD';

/** The BCRP writes September as «Sep» or «Set»; both are accepted, nothing else is. */
const MONTHS: Record<string, number> = {
  Ene: 1, Feb: 2, Mar: 3, Abr: 4, May: 5, Jun: 6, Jul: 7, Ago: 8, Sep: 9, Set: 9, Oct: 10, Nov: 11, Dic: 12,
};

/**
 * Peru's weighted-average selling rate of the banking system as the SBS publishes it, read from the
 * BCRP's statistics API (series `PD04640PD`).
 *
 * It answers `{ config: { title, series: [{ name, dec }] }, periods: [{ name: 'DD.Mmm.YY', values:
 * ['3.758'] }] }`, with `n.d.` for a day with no figure.
 */
export const officialRateFeed: OfficialRateFeed = {
  code: CODE,
  country: 'PE',
  publication: 'Tipo de cambio promedio ponderado venta del sistema bancario (SBS)',
  currencies: ['USD'],
  effectiveFrom: 'publication-day',
  publishedAfter: { timeZone: 'America/Lima', time: '20:00' },
  datesAhead: 0,
  maxDailyChange: 0.1,
  credentialEnv: null,
  formatEstablishedFrom: 'documentation',
  request: ({ from, to }) => ({
    url: `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/${SERIES}/json/${from}/${to}`,
    headers: { Accept: 'application/json' },
  }),
  parse: (body) => {
    const response = objectAt(CODE, jsonBody(CODE, body), 'the response');
    // A range with no figures answers without `periods`.
    if (response['periods'] === undefined) return [];
    return uniqueQuotes(
      CODE,
      arrayAt(CODE, response['periods'], 'periods').flatMap((value, index) => {
        const period = objectAt(CODE, value, `periods[${index}]`);
        const match = typeof period['name'] === 'string' ? period['name'].match(/^(\d{2})\.([A-Z][a-z]{2})\.(\d{2})$/) : null;
        if (!match || !MONTHS[match[2]]) {
          throw new OfficialRateFormatError(CODE, `periods[${index}].name is not a DD.Mmm.YY day (${JSON.stringify(period['name'])})`);
        }
        const [figure] = arrayAt(CODE, period['values'], `periods[${index}].values`);
        if (figure === 'n.d.') return [];
        return [
          {
            currency: 'USD',
            publishedOn: calendarDay(CODE, 2000 + Number(match[3]), MONTHS[match[2]], Number(match[1]), `periods[${index}].name`),
            rate: positiveRate(CODE, figure, `periods[${index}].values[0]`),
          },
        ];
      }),
    );
  },
};
