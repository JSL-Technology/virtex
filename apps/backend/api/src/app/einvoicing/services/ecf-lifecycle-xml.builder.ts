import { Injectable } from '@nestjs/common';
import * as xmlbuilder from 'xmlbuilder';

export interface CommercialApprovalContext {
  /** RNC of the supplier that issued the comprobante being answered. */
  rncEmisor: string;
  /** RNC of the tenant answering it — the buyer named on the comprobante. */
  rncComprador: string;
  /** The supplier's e-NCF. */
  eNCF: string;
  /** Issue date of the answered comprobante, DD-MM-YYYY. */
  fechaEmision: string;
  /** Total of the answered comprobante. Must equal the supplier's to the cent. */
  montoTotal: number;
  /** '1' aprobado, '2' rechazado. */
  estado: '1' | '2';
  /** Mandatory when `estado` is '2'. */
  detalleMotivoRechazo?: string;
  /** DD-MM-YYYY HH:mm:ss. */
  fechaHoraAprobacion: string;
}

/** One contiguous stretch of an authorized range that will never be used. */
export interface VoidedSequenceRange {
  /** DGII document type code carried by the e-NCF (`31`, `32`, …). */
  tipoECF: string;
  /** First e-NCF of the stretch, in full (`E310000000042`). */
  desde: string;
  /** Last e-NCF of the stretch, in full. */
  hasta: string;
}

export interface SequenceVoidContext {
  /** RNC of the taxpayer voiding the numbers. */
  rnc: string;
  /** DD-MM-YYYY HH:mm:ss. */
  fechaHoraAnulacion: string;
  ranges: VoidedSequenceRange[];
}

/**
 * Builds the two DGII messages that are part of the e-CF cycle but are not comprobantes.
 *
 * ## Why these are separate from {@link EcfXmlBuilderService}
 *
 * They share nothing with a comprobante beyond the signature: different root element, different
 * schema, different endpoint, no totals, no lines. Folding them into the comprobante builder would
 * have meant a context object where most fields are meaningless for most callers.
 *
 * ## On the element names
 *
 * These follow the ACECF and ANECF layouts published with DGII Norma 01-2020 and its e-CF format
 * annexes. They could NOT be verified against the live XSD from this environment — the DGII hosts
 * are unreachable from it — so the shape is asserted by unit tests against the documented layout
 * and nothing more. Before a tenant transmits in Producción, run one message of each kind through
 * TesteCF and compare the rejection messages: the DGII names the offending element, which is the
 * cheapest possible conformance check and the one an operator can run without this codebase.
 *
 * The signature is applied afterwards by {@link EcfSignerService} with the root local name — `ACECF`
 * or `ANECF` — so the enveloped reference resolves the same way it does for a comprobante.
 */
@Injectable()
export class EcfLifecycleXmlBuilder {
  private static readonly XSI = 'http://www.w3.org/2001/XMLSchema-instance';

  /** Aprobación Comercial: the buyer's verdict on a comprobante received from a supplier. */
  buildCommercialApproval(ctx: CommercialApprovalContext): string {
    const root = xmlbuilder
      .create('ACECF', { encoding: 'UTF-8' })
      .att('xmlns:xsi', EcfLifecycleXmlBuilder.XSI);

    const detalle = root.ele('DetalleAprobacionComercial');
    detalle.ele('Version', '1.0');
    detalle.ele('RNCEmisor', ctx.rncEmisor);
    detalle.ele('eNCF', ctx.eNCF);
    detalle.ele('FechaEmision', ctx.fechaEmision);
    detalle.ele('MontoTotal', this.money(ctx.montoTotal));
    detalle.ele('RNCComprador', ctx.rncComprador);
    detalle.ele('Estado', ctx.estado);

    // Only present on a rejection. An empty element here is itself a schema violation, which is why
    // it is conditional rather than always written with a blank value.
    if (ctx.estado === '2' && ctx.detalleMotivoRechazo) {
      detalle.ele('DetalleMotivoRechazo', ctx.detalleMotivoRechazo);
    }

    detalle.ele('FechaHoraAprobacionComercial', ctx.fechaHoraAprobacion);

    return root.end({ pretty: false });
  }

  /** Anulación de e-NCF: authorized numbers the taxpayer declares it will never use. */
  buildSequenceVoid(ctx: SequenceVoidContext): string {
    const root = xmlbuilder
      .create('ANECF', { encoding: 'UTF-8' })
      .att('xmlns:xsi', EcfLifecycleXmlBuilder.XSI);

    const anulacion = root.ele('Anulacion');
    anulacion.ele('Version', '1.0');
    anulacion.ele('RNC', ctx.rnc);
    anulacion.ele('CantidadeNCFAnulados', String(this.countVoided(ctx.ranges)));
    anulacion.ele('FechaHoraAnulacioneNCF', ctx.fechaHoraAnulacion);

    ctx.ranges.forEach((range, index) => {
      const info = anulacion.ele('InformacioneNCF');
      // Line number within the message, 1-based, as the schema's `Linea` attribute expects.
      info.att('Linea', String(index + 1));
      // '1' = anulación por rango. The other codes cover single numbers and full-range voids; a
      // single number is expressed here as a range whose ends coincide, which is valid and keeps
      // one code path instead of three.
      info.ele('TipoAnulacion', '1');
      info.ele('TipoeCF', range.tipoECF);
      info.ele('SecuenciaeNCFDesde', range.desde);
      info.ele('SecuenciaeNCFHasta', range.hasta);
      info.ele('CantidadeNCFAnulados', String(this.countRange(range)));
    });

    return root.end({ pretty: false });
  }

  /** Numbers covered by a stretch, inclusive of both ends. */
  countRange(range: VoidedSequenceRange): number {
    const from = this.sequenceNumber(range.desde);
    const to = this.sequenceNumber(range.hasta);
    return Math.max(0, to - from + 1);
  }

  private countVoided(ranges: VoidedSequenceRange[]): number {
    return ranges.reduce((total, range) => total + this.countRange(range), 0);
  }

  /**
   * The numeric part of an e-NCF.
   *
   * `E310000000042` → 42. Parsed rather than assumed, because a range whose ends were entered with
   * different prefixes would otherwise produce a nonsensical count that the DGII rejects with a
   * message naming the total, not the ends.
   */
  private sequenceNumber(eNcf: string): number {
    const digits = eNcf.replace(/^E?\d{2}/, '');
    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private money(n: number): string {
    return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
  }
}
