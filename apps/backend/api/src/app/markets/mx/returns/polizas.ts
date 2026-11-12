import * as xmlbuilder from 'xmlbuilder';
import type { MarketReturnFiling, ReturnDataset } from '../../contracts';
import { POLIZAS_NS, XSI_NS, fileName, money, pad2, rfcOf } from './shared';

/**
 * Pólizas del periodo — every entry posted in the period, with its lines. Filed on request, when
 * the authority audits, refunds or offsets.
 *
 * `NumUnIdenPol` is the entry's own number — gap-free, per journal, per fiscal year — which is the
 * requirement that usually forces a rewrite of a ledger's numbering and which this product already
 * satisfied before the file existed. An entry with no number has not been posted and is not part of
 * the filing.
 */
export const polizas: MarketReturnFiling = {
  code: 'polizas',
  labelKey: 'returns.mx.polizas',
  periodicity: 'ON_REQUEST',
  mediaType: 'application/xml; charset=utf-8',
  extension: 'xml',
  // The SAT asks for it, for an audit or a refund: tracking it as a monthly filing would show
  // eleven months «not filed» that were never due.
  tracked: false,
  options: [
    {
      name: 'tipoSolicitud',
      labelKey: 'returns.mx.option.tipo_solicitud',
      kind: 'CHOICE',
      // `AF` acto de fiscalización, `FC` fiscalización compulsa, `DE` devolución, `CO` compensación.
      values: ['AF', 'FC', 'DE', 'CO'],
    },
    { name: 'numOrden', labelKey: 'returns.mx.option.num_orden', kind: 'TEXT' },
    { name: 'numTramite', labelKey: 'returns.mx.option.num_tramite', kind: 'TEXT' },
  ],
  async build(dataset: ReturnDataset, options) {
    const rfc = rfcOf(dataset.filer.taxId);
    if (!rfc) return { refusal: { messageKey: 'compliance.organization_has_no_rfc_file_sat' } };

    const tipoSolicitud = options['tipoSolicitud'] ?? 'AF';
    const entries = await dataset.journals();

    const root = xmlbuilder
      .create('PLZ:Polizas', { encoding: 'UTF-8' })
      .att('xmlns:PLZ', POLIZAS_NS)
      .att('xmlns:xsi', XSI_NS)
      .att('xsi:schemaLocation', `${POLIZAS_NS} ${POLIZAS_NS}/PolizasPeriodo_1_3.xsd`)
      .att('Version', '1.3')
      .att('RFC', rfc)
      .att('Mes', pad2(dataset.period.month))
      .att('Anio', String(dataset.period.year))
      .att('TipoSolicitud', tipoSolicitud);

    // `NumOrden` belongs to the audits — an acto de fiscalización (AF) or a fiscalización compulsa
    // (FC); `NumTramite` to the procedures the taxpayer started — a refund (DE) or an offset (CO).
    // The XSD requires each for exactly those types, and writing the wrong one, or both, is a
    // rejected upload. CO used to be read as «certification» and given the order number.
    //
    // Which one is required depends on the other answer, so the declaration cannot say it and this
    // is where it is said: a file that names no procedure is one the SAT rejects on upload.
    const audit = tipoSolicitud === 'AF' || tipoSolicitud === 'FC';
    const reference = audit ? options['numOrden'] : options['numTramite'];
    if (!reference) {
      return {
        refusal: {
          messageKey: audit ? 'returns.mx.polizas_order_required' : 'returns.mx.polizas_procedure_required',
          params: { request: tipoSolicitud },
        },
      };
    }
    root.att(audit ? 'NumOrden' : 'NumTramite', reference);

    for (const entry of entries) {
      const poliza = root
        .ele('PLZ:Poliza')
        .att('NumUnIdenPol', entry.number)
        .att('Fecha', entry.date)
        .att('Concepto', entry.description || entry.number);

      for (const line of entry.lines) {
        poliza
          .ele('PLZ:Transaccion')
          .att('NumCta', line.accountCode)
          .att('DesCta', line.accountName)
          .att('Concepto', line.description || entry.description)
          .att('Debe', money(line.debit))
          .att('Haber', money(line.credit));
      }
    }

    return { file: root.end({ pretty: true }), records: entries.length };
  },
  fileName: (period) => fileName('polizas', period),
};
