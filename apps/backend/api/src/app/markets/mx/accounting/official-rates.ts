import { OfficialRateFeed, OfficialRateFormatError } from '../../contracts';
import { arrayAt, dayFromDmy, jsonBody, objectAt, positiveRate, uniqueQuotes } from '../../kit/official-rates';

const CODE = 'MX-BANXICO-FIX-DOF';
/** Banxico SIE: «tipo de cambio para solventar obligaciones denominadas en moneda extranjera», by its date in the DOF. */
const SERIES = 'SF60653';

/**
 * Mexico's FIX as published in the Diario Oficial de la Federación, read from Banco de México's SIE
 * API (series `SF60653`), which requires a free token in the `Bmx-Token` header.
 *
 * A contribution is converted at the rate the DOF published the day BEFORE it is caused, and on a
 * day with no publication at the last one before it (CFF art. 20): so a figure dated by its
 * publication is the official rate from the next day on. The SIE answers
 * `{ bmx: { series: [{ idSerie, titulo, datos: [{ fecha: 'DD/MM/YYYY', dato }] }] } }` and writes
 * `N/E` for a day with no figure.
 */
export const officialRateFeed: OfficialRateFeed = {
  code: CODE,
  country: 'MX',
  publication: 'Tipo de cambio FIX publicado en el Diario Oficial de la Federación',
  currencies: ['USD'],
  effectiveFrom: 'day-after-publication',
  // Determined at midday and published the next business day; the SIE has it by early afternoon.
  publishedAfter: { timeZone: 'America/Mexico_City', time: '12:30' },
  datesAhead: 0,
  maxDailyChange: 0.1,
  credentialEnv: 'BANXICO_SIE_TOKEN',
  formatEstablishedFrom: 'documentation',
  request: ({ from, to }, credential) => ({
    url: `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${SERIES}/datos/${from}/${to}`,
    headers: { Accept: 'application/json', 'Bmx-Token': credential ?? '' },
  }),
  parse: (body) => {
    const bmx = objectAt(CODE, objectAt(CODE, jsonBody(CODE, body), 'the response')['bmx'], 'bmx');
    const series = arrayAt(CODE, bmx['series'], 'bmx.series').map((value, index) => objectAt(CODE, value, `series ${index + 1}`));
    const ours = series.find((entry) => entry['idSerie'] === SERIES);
    if (!ours) throw new OfficialRateFormatError(CODE, `the response has no series ${SERIES}`);
    // A range with no publication answers the series without `datos`.
    if (ours['datos'] === undefined) return [];
    return uniqueQuotes(
      CODE,
      arrayAt(CODE, ours['datos'], `${SERIES}.datos`).flatMap((value, index) => {
        const point = objectAt(CODE, value, `${SERIES}.datos[${index}]`);
        if (point['dato'] === 'N/E') return [];
        return [
          {
            currency: 'USD',
            publishedOn: dayFromDmy(CODE, point['fecha'], `${SERIES}.datos[${index}].fecha`),
            rate: positiveRate(CODE, point['dato'], `${SERIES}.datos[${index}].dato`),
          },
        ];
      }),
    );
  },
};
