import { OfficialRateFeed, OfficialRateFormatError } from '../../contracts';
import { arrayAt, isoDay, jsonBody, objectAt, positiveRate, uniqueQuotes } from '../../kit/official-rates';

const CODE = 'CO-TRM';

/**
 * Colombia's TRM, as the open-data portal publishes the Superintendencia Financiera's certified
 * series (dataset `32sa-8pi3`, a Socrata resource).
 *
 * Each row states the period it is in force for (`vigenciadesde`..`vigenciahasta`): the TRM of a
 * Friday covers the weekend and is dated by the first day it applies to, so it is stored on that
 * day and the rate lookup carries it forward. The portal answers rows of `{ valor, unidad,
 * vigenciadesde, vigenciahasta }` with every value as a string.
 */
export const officialRateFeed: OfficialRateFeed = {
  code: CODE,
  country: 'CO',
  publication: 'Tasa de Cambio Representativa del Mercado (TRM)',
  currencies: ['USD'],
  effectiveFrom: 'publication-day',
  // Certified the afternoon before the day it applies to.
  publishedAfter: { timeZone: 'America/Bogota', time: '18:00' },
  datesAhead: 4,
  maxDailyChange: 0.1,
  credentialEnv: null,
  formatEstablishedFrom: 'documentation',
  request: ({ from, to }) => {
    const where = `vigenciadesde between '${from}T00:00:00' and '${to}T23:59:59'`;
    const query = new URLSearchParams({ $where: where, $order: 'vigenciadesde', $limit: '1000' });
    return { url: `https://www.datos.gov.co/resource/32sa-8pi3.json?${query.toString()}`, headers: { Accept: 'application/json' } };
  },
  parse: (body) => {
    const rows = arrayAt(CODE, jsonBody(CODE, body), 'the response');
    return uniqueQuotes(
      CODE,
      rows.map((value, index) => {
        const row = objectAt(CODE, value, `row ${index + 1}`);
        if (row['unidad'] !== 'COP') {
          throw new OfficialRateFormatError(CODE, `row ${index + 1} is in ${JSON.stringify(row['unidad'])}, not COP`);
        }
        return {
          currency: 'USD',
          publishedOn: isoDay(CODE, row['vigenciadesde'], `row ${index + 1} vigenciadesde`),
          rate: positiveRate(CODE, row['valor'], `row ${index + 1} valor`),
        };
      }),
    );
  },
};
