import { OfficialRateFeed } from '../../contracts';
import { arrayAt, isoDay, jsonBody, mdy, objectAt, positiveRate, uniqueQuotes } from '../../kit/official-rates';

const CODE = 'BR-BCB-PTAX-VENDA';

/**
 * Brazil's PTAX selling rate, read from the Banco Central do Brasil's Olinda OData service
 * (`PTAX/v1`, `CotacaoDolarPeriodo`: the closing PTAX of each day).
 *
 * It takes its dates as `MM-DD-YYYY` and answers `{ value: [{ cotacaoVenda, dataHoraCotacao:
 * 'YYYY-MM-DD HH:mm:ss.SSS' }] }`.
 */
export const officialRateFeed: OfficialRateFeed = {
  code: CODE,
  country: 'BR',
  publication: 'Taxa PTAX de venda (fechamento)',
  currencies: ['USD'],
  effectiveFrom: 'publication-day',
  publishedAfter: { timeZone: 'America/Sao_Paulo', time: '13:30' },
  datesAhead: 0,
  maxDailyChange: 0.1,
  credentialEnv: null,
  formatEstablishedFrom: 'documentation',
  request: ({ from, to }) => {
    const resource =
      `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
      `?@dataInicial='${mdy(from)}'&@dataFinalCotacao='${mdy(to)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
    return { url: `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/${resource}`, headers: { Accept: 'application/json' } };
  },
  parse: (body) => {
    const response = objectAt(CODE, jsonBody(CODE, body), 'the response');
    return uniqueQuotes(
      CODE,
      arrayAt(CODE, response['value'], 'value').map((value, index) => {
        const quote = objectAt(CODE, value, `value[${index}]`);
        return {
          currency: 'USD',
          publishedOn: isoDay(CODE, quote['dataHoraCotacao'], `value[${index}].dataHoraCotacao`),
          rate: positiveRate(CODE, quote['cotacaoVenda'], `value[${index}].cotacaoVenda`),
        };
      }),
    );
  },
};
