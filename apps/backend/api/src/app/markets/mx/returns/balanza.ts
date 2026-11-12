import * as xmlbuilder from 'xmlbuilder';
import type { MarketReturnFiling, ReturnDataset } from '../../contracts';
import { BALANZA_NS, XSI_NS, cents, fileName, money, naturalise, pad2, rfcOf } from './shared';

/**
 * Balanza de comprobación — opening balance, the period's movement and closing balance, per
 * account. Filed monthly.
 *
 * `TipoEnvio` is `N` for the ordinary filing and `C` for a complementary one that corrects it; the
 * filer says which, because only they know whether they are correcting something already filed.
 * `FechaModBal` is required on a complementary filing and rejected on an ordinary one, which is why
 * it is not simply always written.
 */
export const balanza: MarketReturnFiling = {
  code: 'balanza',
  labelKey: 'returns.mx.balanza',
  periodicity: 'MONTHLY',
  mediaType: 'application/xml; charset=utf-8',
  extension: 'xml',
  tracked: true,
  options: [
    { name: 'tipoEnvio', labelKey: 'returns.mx.option.tipo_envio', kind: 'CHOICE', values: ['N', 'C'] },
    { name: 'fechaModBal', labelKey: 'returns.mx.option.fecha_mod_bal', kind: 'DATE' },
  ],
  async build(dataset: ReturnDataset, options) {
    const rfc = rfcOf(dataset.filer.taxId);
    if (!rfc) return { refusal: { messageKey: 'compliance.organization_has_no_rfc_file_sat' } };

    const tipoEnvio = options['tipoEnvio'] === 'C' ? 'C' : 'N';
    const accounts = await dataset.accounts();

    const root = xmlbuilder
      .create('BCE:Balanza', { encoding: 'UTF-8' })
      .att('xmlns:BCE', BALANZA_NS)
      .att('xmlns:xsi', XSI_NS)
      .att('xsi:schemaLocation', `${BALANZA_NS} ${BALANZA_NS}/BalanzaComprobacion_1_3.xsd`)
      .att('Version', '1.3')
      .att('RFC', rfc)
      .att('Mes', pad2(dataset.period.month))
      .att('Anio', String(dataset.period.year))
      .att('TipoEnvio', tipoEnvio);

    if (tipoEnvio === 'C' && options['fechaModBal']) root.att('FechaModBal', options['fechaModBal']);

    let records = 0;
    for (const account of accounts) {
      // An account that neither carries a balance nor moved is not part of the month's balanza.
      // Filing every account in the chart with four zeroes is a larger file that says less.
      if (
        cents(account.openingBalance) === 0 &&
        cents(account.debit) === 0 &&
        cents(account.credit) === 0 &&
        cents(account.closingBalance) === 0
      ) {
        continue;
      }

      root
        .ele('BCE:Ctas')
        .att('NumCta', account.code)
        // The SAT states balances in the account's own natural sense — a positive figure for a
        // liability means it is owed — while the ledger stores them signed `debit − credit`.
        .att('SaldoIni', money(naturalise(account, account.openingBalance)))
        .att('Debe', money(account.debit))
        .att('Haber', money(account.credit))
        .att('SaldoFin', money(naturalise(account, account.closingBalance)));
      records += 1;
    }

    return { file: root.end({ pretty: true }), records };
  },
  fileName: (period) => fileName('balanza', period),
};
