import { OfficialRateFeed, OfficialRateFormatError } from '../../contracts';
import { arrayAt, isoDay, jsonBody, objectAt, positiveRate, uniqueQuotes } from '../../kit/official-rates';

const CODE = 'AR-BCRA-A3500';

/**
 * Argentina's reference rate under Communication «A» 3500, read from the BCRA's public
 * exchange-statistics API (`estadisticascambiarias/v1.0`).
 *
 * It answers `{ status, metadata, results: [{ fecha, detalle: [{ codigoMoneda, descripcion,
 * tipoPase, tipoCotizacion }] }] }`, where `tipoCotizacion` is pesos per unit of the currency.
 * No bound on the daily move: the peso has moved by more in a day than any bound would allow, and a
 * close stuck on a confirmation is worse than one booked at the published figure.
 */
export const officialRateFeed: OfficialRateFeed = {
  code: CODE,
  country: 'AR',
  publication: 'Tipo de cambio de referencia Comunicación «A» 3500',
  currencies: ['USD'],
  effectiveFrom: 'publication-day',
  publishedAfter: { timeZone: 'America/Argentina/Buenos_Aires', time: '15:30' },
  datesAhead: 0,
  maxDailyChange: null,
  credentialEnv: null,
  formatEstablishedFrom: 'documentation',
  request: ({ from, to }) => ({
    url: `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=${from}&fechahasta=${to}`,
    headers: { Accept: 'application/json' },
  }),
  parse: (body) => {
    const response = objectAt(CODE, jsonBody(CODE, body), 'the response');
    if (response['status'] !== 200) {
      throw new OfficialRateFormatError(CODE, `the response status is ${JSON.stringify(response['status'])}`);
    }
    return uniqueQuotes(
      CODE,
      arrayAt(CODE, response['results'], 'results').flatMap((value, index) => {
        const day = objectAt(CODE, value, `results[${index}]`);
        const publishedOn = isoDay(CODE, day['fecha'], `results[${index}].fecha`);
        const usd = arrayAt(CODE, day['detalle'], `results[${index}].detalle`)
          .map((entry, position) => objectAt(CODE, entry, `results[${index}].detalle[${position}]`))
          .filter((entry) => entry['codigoMoneda'] === 'USD');
        if (usd.length === 0) return [];
        if (usd.length > 1) throw new OfficialRateFormatError(CODE, `results[${index}] quotes USD twice`);
        return [{ currency: 'USD', publishedOn, rate: positiveRate(CODE, usd[0]['tipoCotizacion'], `results[${index}] tipoCotizacion`) }];
      }),
    );
  },
};
