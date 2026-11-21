import * as xmlbuilder from 'xmlbuilder';
import type { MarketReturnFiling, ReturnDataset } from '../../contracts';
import { CATALOGO_NS, XSI_NS, fileName, levelOf, natureOf, pad2, parentCodeOf, rfcOf } from './shared';

/**
 * Catálogo de cuentas — the taxpayer's chart, each account mapped onto a code from the SAT's
 * published grouping list. Filed once and again whenever the chart changes.
 *
 * An account with no grouping code cannot be filed: the taxpayer's own numbering says nothing to
 * the authority. The absence is refused by name rather than emitted as an empty attribute the SAT
 * rejects on upload.
 */
export const catalogo: MarketReturnFiling = {
  code: 'catalogo',
  labelKey: 'returns.mx.catalogo',
  periodicity: 'MONTHLY',
  mediaType: 'application/xml; charset=utf-8',
  extension: 'xml',
  tracked: true,
  async build(dataset: ReturnDataset) {
    const rfc = rfcOf(dataset.filer.taxId);
    if (!rfc) return { refusal: { messageKey: 'compliance.organization_has_no_rfc_file_sat' } };

    const accounts = await dataset.accounts();
    const missing = accounts.filter((account) => !account.groupingCode?.trim());
    if (missing.length > 0) {
      return {
        refusal: {
          messageKey: 'compliance.count_account_have_no_sat_grouping',
          params: { count: missing.length, example: missing[0].code },
        },
      };
    }

    const root = xmlbuilder
      .create('catalogocuentas:Catalogo', { encoding: 'UTF-8' })
      .att('xmlns:catalogocuentas', CATALOGO_NS)
      .att('xmlns:xsi', XSI_NS)
      .att('xsi:schemaLocation', `${CATALOGO_NS} ${CATALOGO_NS}/CatalogoCuentas_1_3.xsd`)
      .att('Version', '1.3')
      .att('RFC', rfc)
      .att('Mes', pad2(dataset.period.month))
      .att('Anio', String(dataset.period.year));

    for (const account of accounts) {
      const node = root
        .ele('catalogocuentas:Ctas')
        .att('CodAgrup', (account.groupingCode ?? '').trim())
        .att('NumCta', account.code)
        .att('Desc', account.name)
        .att('Nivel', String(levelOf(account.code)))
        .att('Natur', natureOf(account));

      // `SubCtaDe` names the parent account by ITS OWN number, which is what makes the file a tree
      // rather than a list. Derived from the code's own segments so it cannot disagree with the
      // hierarchy the product shows.
      const parent = parentCodeOf(account.code);
      if (parent) node.att('SubCtaDe', parent);
    }

    return { file: root.end({ pretty: true }), records: accounts.length };
  },
  fileName: (period) => fileName('catalogo', period),
};
