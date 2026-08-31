import { Injectable } from '@nestjs/common';
import * as xmlbuilder from 'xmlbuilder';

/**
 * Party and line inputs for building an e-CF, decoupled from persistence entities so the builder is
 * pure and unit-testable.
 */
export interface EcfEmisor {
  rnc: string;
  razonSocial: string;
  direccion?: string;
  municipio?: string;
  provincia?: string;
}

export interface EcfComprador {
  rnc?: string;
  razonSocial?: string;
}

export interface EcfItemInput {
  nombre: string;
  /** 1 = bien, 2 = servicio. */
  indicadorBienoServicio: '1' | '2';
  cantidad: number;
  precioUnitario: number;
  /** ITBIS rate as a fraction (0.18, 0.16, 0). */
  itbisTasa: number;
}

export interface EcfModifica {
  eNCFModificado: string;
  fechaEmisionModificado: string; // DD-MM-YYYY
  /** 1 = anula, 2 = corrige texto, 3 = corrige montos. */
  codigoModificacion: string;
}

export interface EcfBuildContext {
  /** DGII document type: '31', '32', '33', '34'… */
  tipoECF: string;
  eNCF: string;
  fechaVencimientoSecuencia?: string; // DD-MM-YYYY
  /** Tipo de ingresos (DGII catalogue: 01, 02, …). */
  tipoIngresos: string;
  /** 1 = contado, 2 = crédito. */
  tipoPago: string;
  fechaEmision: string; // DD-MM-YYYY
  emisor: EcfEmisor;
  comprador?: EcfComprador;
  items: EcfItemInput[];
  modifica?: EcfModifica;
  /** DD-MM-YYYY HH:mm:ss. Defaults to the emission date at midnight when omitted. */
  fechaHoraFirma?: string;
}

interface TaxBuckets {
  montoGravadoI1: number; // 18%
  montoGravadoI2: number; // 16%
  montoExento: number;
  itbis1: number;
  itbis2: number;
}

/**
 * Builds the e-CF XML per the DGII "Formato de e-CF" (v1.0) element structure. Money is emitted
 * with two decimals and a dot separator, tax buckets are split by ITBIS rate, and totals are derived
 * from the line items — never taken on trust.
 *
 * NOTE: the DGII versions its XSD. The element set below follows the published v1.0 schema for the
 * facturación (E31), consumo (E32) and nota de crédito (E34) documents; when the operator's authorized
 * environment publishes a different schema version, validate this output against that XSD. Every value
 * is real data derived from the invoice — there are no placeholders.
 */
@Injectable()
export class EcfXmlBuilderService {
  static readonly ITBIS_I1 = 0.18;
  static readonly ITBIS_I2 = 0.16;

  build(ctx: EcfBuildContext): string {
    const lines = ctx.items.map((item, index) => {
      const monto = this.round(item.cantidad * item.precioUnitario);
      return {
        NumeroLinea: index + 1,
        IndicadorFacturacion: this.indicadorFacturacion(item.itbisTasa),
        NombreItem: item.nombre,
        IndicadorBienoServicio: item.indicadorBienoServicio,
        CantidadItem: this.num(item.cantidad),
        PrecioUnitarioItem: this.money(item.precioUnitario),
        MontoItem: this.money(monto),
      };
    });

    const buckets = this.computeBuckets(ctx.items);
    const montoGravadoTotal = this.round(buckets.montoGravadoI1 + buckets.montoGravadoI2);
    const totalItbis = this.round(buckets.itbis1 + buckets.itbis2);
    const montoTotal = this.round(montoGravadoTotal + buckets.montoExento + totalItbis);

    const idDoc: Record<string, unknown> = {
      TipoeCF: ctx.tipoECF,
      eNCF: ctx.eNCF,
    };
    if (ctx.fechaVencimientoSecuencia) idDoc.FechaVencimientoSecuencia = ctx.fechaVencimientoSecuencia;
    idDoc.IndicadorMontoGravado = buckets.montoGravadoI1 + buckets.montoGravadoI2 > 0 ? 1 : 0;
    idDoc.TipoIngresos = ctx.tipoIngresos;
    idDoc.TipoPago = ctx.tipoPago;

    const totales: Record<string, unknown> = {};
    if (montoGravadoTotal > 0) {
      totales.MontoGravadoTotal = this.money(montoGravadoTotal);
      if (buckets.montoGravadoI1 > 0) totales.MontoGravadoI1 = this.money(buckets.montoGravadoI1);
      if (buckets.montoGravadoI2 > 0) totales.MontoGravadoI2 = this.money(buckets.montoGravadoI2);
    }
    if (buckets.montoExento > 0) totales.MontoExento = this.money(buckets.montoExento);
    if (buckets.montoGravadoI1 > 0) totales.ITBIS1 = 18;
    if (buckets.montoGravadoI2 > 0) totales.ITBIS2 = 16;
    if (totalItbis > 0) {
      totales.TotalITBIS = this.money(totalItbis);
      if (buckets.itbis1 > 0) totales.TotalITBIS1 = this.money(buckets.itbis1);
      if (buckets.itbis2 > 0) totales.TotalITBIS2 = this.money(buckets.itbis2);
    }
    totales.MontoTotal = this.money(montoTotal);

    const emisor: Record<string, unknown> = {
      RNCEmisor: ctx.emisor.rnc,
      RazonSocialEmisor: ctx.emisor.razonSocial,
    };
    if (ctx.emisor.direccion) emisor.DireccionEmisor = ctx.emisor.direccion;
    if (ctx.emisor.municipio) emisor.Municipio = ctx.emisor.municipio;
    if (ctx.emisor.provincia) emisor.Provincia = ctx.emisor.provincia;
    emisor.FechaEmision = ctx.fechaEmision;

    const encabezado: Record<string, unknown> = {
      Version: '1.0',
      IdDoc: idDoc,
      Emisor: emisor,
    };

    if (ctx.comprador && (ctx.comprador.rnc || ctx.comprador.razonSocial)) {
      const comprador: Record<string, unknown> = {};
      if (ctx.comprador.rnc) comprador.RNCComprador = ctx.comprador.rnc;
      if (ctx.comprador.razonSocial) comprador.RazonSocialComprador = ctx.comprador.razonSocial;
      encabezado.Comprador = comprador;
    }

    encabezado.Totales = totales;

    const ecf: Record<string, unknown> = { Encabezado: encabezado };
    ecf.DetallesItems = { Item: lines };

    // Referencia al comprobante modificado (obligatorio en notas de crédito/débito, E33/E34).
    if (ctx.modifica) {
      ecf.InformacionReferencia = {
        NCFModificado: ctx.modifica.eNCFModificado,
        FechaNCFModificado: ctx.modifica.fechaEmisionModificado,
        CodigoModificacion: ctx.modifica.codigoModificacion,
      };
    }

    ecf.FechaHoraFirma = ctx.fechaHoraFirma ?? this.fechaHoraFirma(ctx.fechaEmision);

    return xmlbuilder.create({ ECF: ecf }, { encoding: 'UTF-8' }).end({ pretty: false });
  }

  private computeBuckets(items: EcfItemInput[]): TaxBuckets {
    const b: TaxBuckets = { montoGravadoI1: 0, montoGravadoI2: 0, montoExento: 0, itbis1: 0, itbis2: 0 };
    for (const item of items) {
      const monto = item.cantidad * item.precioUnitario;
      if (this.approx(item.itbisTasa, EcfXmlBuilderService.ITBIS_I1)) {
        b.montoGravadoI1 += monto;
        b.itbis1 += monto * EcfXmlBuilderService.ITBIS_I1;
      } else if (this.approx(item.itbisTasa, EcfXmlBuilderService.ITBIS_I2)) {
        b.montoGravadoI2 += monto;
        b.itbis2 += monto * EcfXmlBuilderService.ITBIS_I2;
      } else {
        b.montoExento += monto;
      }
    }
    b.montoGravadoI1 = this.round(b.montoGravadoI1);
    b.montoGravadoI2 = this.round(b.montoGravadoI2);
    b.montoExento = this.round(b.montoExento);
    b.itbis1 = this.round(b.itbis1);
    b.itbis2 = this.round(b.itbis2);
    return b;
  }

  /** 1 = gravado 18%, 2 = gravado 16%, 4 = exento. */
  private indicadorFacturacion(tasa: number): number {
    if (this.approx(tasa, EcfXmlBuilderService.ITBIS_I1)) return 1;
    if (this.approx(tasa, EcfXmlBuilderService.ITBIS_I2)) return 2;
    return 4;
  }

  private approx(a: number, b: number): boolean {
    return Math.abs(a - b) < 1e-6;
  }

  private round(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private money(n: number): string {
    return this.round(n).toFixed(2);
  }

  private num(n: number): string {
    return Number.isInteger(n) ? String(n) : String(this.round(n));
  }

  private fechaHoraFirma(fechaEmision: string): string {
    // DGII expects DD-MM-YYYY HH:mm:ss. We keep the emission date and append a midnight-safe stamp
    // computed by the caller's clock at signing; the actual signing timestamp is applied when the
    // submission is built, so here we mirror the emission date with a zeroed time as a stable default.
    return `${fechaEmision} 00:00:00`;
  }
}
