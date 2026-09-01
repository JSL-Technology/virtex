import { Injectable } from '@nestjs/common';
import * as xmlbuilder from 'xmlbuilder';

/**
 * Party and line inputs for building an e-CF, decoupled from persistence entities so the builder is
 * pure and unit-testable.
 */
export interface EcfEmisor {
  rnc: string;
  razonSocial: string;
  nombreComercial?: string;
  direccion?: string;
  /** DGII four-digit municipality code. */
  municipio?: string;
  /** DGII two-digit province code. */
  provincia?: string;
  telefono?: string;
  correo?: string;
  webSite?: string;
  /** Economic activity as registered with the DGII. */
  actividadEconomica?: string;
  /** Internal document number, for the issuer's own reconciliation. */
  numeroFacturaInterna?: string;
}

export interface EcfComprador {
  rnc?: string;
  /** Identifier of a non-resident buyer, when they hold no RNC. */
  identificadorExtranjero?: string;
  razonSocial?: string;
  direccion?: string;
  municipio?: string;
  provincia?: string;
  correo?: string;
}

export interface EcfItemInput {
  nombre: string;
  descripcion?: string;
  /** 1 = bien, 2 = servicio. */
  indicadorBienoServicio: '1' | '2';
  cantidad: number;
  /** DGII unit-of-measure code, when the unit maps to one. */
  unidadMedida?: string | null;
  precioUnitario: number;
  /** Discount granted on the line, in currency. */
  descuentoMonto?: number;
  /** ITBIS rate as a fraction (0.18, 0.16, 0). */
  itbisTasa: number;
  /** True when the line is exempt (no right to deduct), as opposed to zero-rated. */
  exento?: boolean;
  /** Excise duty (ISC) charged on the line. */
  montoImpuestoSelectivo?: number;
}

export interface EcfModifica {
  eNCFModificado: string;
  fechaEmisionModificado: string; // DD-MM-YYYY
  /** 1 = anula, 2 = corrige texto, 3 = corrige montos, 4 = reemplaza contingencia. */
  codigoModificacion: string;
  /** RNC of the other taxpayer when the modified comprobante is not our own. */
  rncOtroContribuyente?: string;
}

/** A single settlement of the document, as `TablaFormasPago` expects it. */
export interface EcfFormaPago {
  /** DGII code: 01 efectivo, 02 cheque/transferencia, 03 tarjeta, 04 crédito… */
  forma: string;
  monto: number;
}

export interface EcfOtraMoneda {
  /** ISO 4217 of the document currency, when it is not Dominican pesos. */
  tipoMoneda: string;
  /** Units of DOP per one unit of `tipoMoneda`. */
  tipoCambio: number;
  montoGravadoTotal?: number;
  montoExento?: number;
  totalItbis?: number;
  montoTotal: number;
}

export interface EcfBuildContext {
  /** DGII document type: '31', '32', '33', '34'… */
  tipoECF: string;
  eNCF: string;
  /** Expiry of the authorized range, DD-MM-YYYY. Mandatory in the schema. */
  fechaVencimientoSecuencia?: string;
  /** Tipo de ingresos (DGII catalogue: 01, 02, …). */
  tipoIngresos: string;
  /** 1 = contado, 2 = crédito. */
  tipoPago: string;
  formasPago?: EcfFormaPago[];
  /** Payment deadline for a credit sale, DD-MM-YYYY. */
  fechaLimitePago?: string;
  /** Days of credit granted. */
  terminoPago?: string;
  fechaEmision: string; // DD-MM-YYYY
  emisor: EcfEmisor;
  comprador?: EcfComprador;
  items: EcfItemInput[];
  /** Document-level discount, in currency. */
  descuentoGlobal?: number;
  /** Legally mandated service charge (propina legal). */
  montoPropinaLegal?: number;
  /** Consumption tax withheld at source by the buyer. */
  itbisRetenido?: number;
  /** Income tax withheld at source by the buyer. */
  isrRetenido?: number;
  otraMoneda?: EcfOtraMoneda;
  modifica?: EcfModifica;
  /** DD-MM-YYYY HH:mm:ss. Defaults to the emission date at midnight when omitted. */
  fechaHoraFirma?: string;
}

interface TaxBuckets {
  montoGravadoI1: number; // 18%
  montoGravadoI2: number; // 16%
  montoGravadoI3: number; // 0% con derecho a deducción
  montoExento: number;
  itbis1: number;
  itbis2: number;
  itbis3: number;
  impuestoSelectivo: number;
}

/**
 * Builds the e-CF XML per the DGII "Formato de e-CF" element structure.
 *
 * ## What this fixes
 *
 * The previous builder emitted a bare `<ECF>` with eleven elements. Everything the DGII's schema
 * marks mandatory beyond that was missing, and each omission is a rejection at reception:
 *
 * * no namespace declaration, so the document could not be validated against the XSD at all;
 * * no `FechaVencimientoSecuencia` — the authorization window every e-NCF is drawn from;
 * * no `TablaFormasPago`, mandatory whenever `TipoPago` is 1 (cash), which is the default;
 * * `Municipio` carried a place NAME (`"Ciudad Probe"`) where the schema demands a coded value;
 * * no `IndicadorEnvioDiferido`, `NombreComercial`, `DescripcionItem`, `UnidadMedida`;
 * * no `Subtotales`, no `DescuentosORecargos`, no `Paginacion`;
 * * no `OtraMoneda`, so an invoice issued in dollars was transmitted as though its amounts were
 *   pesos — a misstatement of the amount, not a formatting detail;
 * * no exempt/zero-rated distinction: `IndicadorFacturacion` collapsed both onto 4 (exempt), which
 *   denies the right to deduct on an export.
 *
 * Money is emitted with two decimals and a dot separator, tax buckets are split by ITBIS rate, and
 * every total is derived from the line items — never taken on trust. The element ORDER matters: the
 * XSD is a sequence, so a correct value in the wrong position is still a rejection.
 */
@Injectable()
export class EcfXmlBuilderService {
  static readonly ITBIS_I1 = 0.18;
  static readonly ITBIS_I2 = 0.16;
  /** The e-CF schema version this builder targets. */
  static readonly VERSION = '1.0';

  build(ctx: EcfBuildContext): string {
    const buckets = this.computeBuckets(ctx.items);
    const montoGravadoTotal = this.round(
      buckets.montoGravadoI1 + buckets.montoGravadoI2 + buckets.montoGravadoI3,
    );
    const totalItbis = this.round(buckets.itbis1 + buckets.itbis2 + buckets.itbis3);
    const descuentoGlobal = this.round(ctx.descuentoGlobal ?? 0);
    const propina = this.round(ctx.montoPropinaLegal ?? 0);
    const montoTotal = this.round(
      montoGravadoTotal +
        buckets.montoExento +
        totalItbis +
        buckets.impuestoSelectivo +
        propina -
        descuentoGlobal,
    );

    const encabezado: Record<string, unknown> = {
      Version: EcfXmlBuilderService.VERSION,
      IdDoc: this.buildIdDoc(ctx, buckets),
      Emisor: this.buildEmisor(ctx),
    };

    const comprador = this.buildComprador(ctx);
    if (comprador) encabezado.Comprador = comprador;

    const informacionesAdicionales = this.buildInformacionesAdicionales(ctx);
    if (informacionesAdicionales) encabezado.InformacionesAdicionales = informacionesAdicionales;

    encabezado.Totales = this.buildTotales({
      buckets,
      montoGravadoTotal,
      totalItbis,
      montoTotal,
      descuentoGlobal,
      propina,
      itbisRetenido: this.round(ctx.itbisRetenido ?? 0),
      isrRetenido: this.round(ctx.isrRetenido ?? 0),
    });

    if (ctx.otraMoneda) encabezado.OtraMoneda = this.buildOtraMoneda(ctx.otraMoneda);

    const ecf: Record<string, unknown> = { Encabezado: encabezado };
    ecf.DetallesItems = { Item: ctx.items.map((item, index) => this.buildItem(item, index)) };

    if (descuentoGlobal > 0) {
      ecf.DescuentosORecargos = {
        DescuentoORecargo: [
          {
            NumeroLinea: 1,
            TipoAjuste: 'D',
            IndicadorNorma: 0,
            DescripcionDescuentoORecargo: 'Descuento comercial',
            TipoValor: '$',
            ValorDescuentoORecargo: this.money(descuentoGlobal),
            MontoDescuentoORecargo: this.money(descuentoGlobal),
          },
        ],
      };
    }

    ecf.Paginacion = { PaginaNo: 1, NoLineaDesde: 1, NoLineaHasta: ctx.items.length };

    // Referencia al comprobante modificado (obligatorio en notas de crédito/débito, E33/E34).
    if (ctx.modifica) {
      const referencia: Record<string, unknown> = {
        NCFModificado: ctx.modifica.eNCFModificado,
      };
      if (ctx.modifica.rncOtroContribuyente) {
        referencia.RNCOtroContribuyente = ctx.modifica.rncOtroContribuyente;
      }
      referencia.FechaNCFModificado = ctx.modifica.fechaEmisionModificado;
      referencia.CodigoModificacion = ctx.modifica.codigoModificacion;
      ecf.InformacionReferencia = referencia;
    }

    ecf.FechaHoraFirma = ctx.fechaHoraFirma ?? this.fechaHoraFirma(ctx.fechaEmision);

    return xmlbuilder
      .create(
        {
          ECF: {
            '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            '@xsi:noNamespaceSchemaLocation': `e-CF ${ctx.tipoECF} v${EcfXmlBuilderService.VERSION}.xsd`,
            ...ecf,
          },
        },
        { encoding: 'UTF-8' },
      )
      .end({ pretty: false });
  }

  // ── Sections ───────────────────────────────────────────────────────────────

  private buildIdDoc(ctx: EcfBuildContext, buckets: TaxBuckets): Record<string, unknown> {
    const idDoc: Record<string, unknown> = {
      TipoeCF: ctx.tipoECF,
      eNCF: ctx.eNCF,
    };
    if (ctx.fechaVencimientoSecuencia) {
      idDoc.FechaVencimientoSecuencia = ctx.fechaVencimientoSecuencia;
    }
    // 0 = transmitted within the deadline. Contingency replacements are declared through the
    // modification code, not here.
    idDoc.IndicadorEnvioDiferido = 0;
    idDoc.IndicadorMontoGravado =
      buckets.montoGravadoI1 + buckets.montoGravadoI2 + buckets.montoGravadoI3 > 0 ? 1 : 0;
    idDoc.TipoIngresos = ctx.tipoIngresos;
    idDoc.TipoPago = ctx.tipoPago;

    // Mandatory whenever the document is settled in cash; a credit sale declares its terms instead.
    if (ctx.formasPago && ctx.formasPago.length > 0) {
      idDoc.TablaFormasPago = {
        FormaDePago: ctx.formasPago.map((pago) => ({
          FormaPago: pago.forma,
          MontoPago: this.money(pago.monto),
        })),
      };
    }
    if (ctx.fechaLimitePago) idDoc.FechaLimitePago = ctx.fechaLimitePago;
    if (ctx.terminoPago) idDoc.TerminoPago = ctx.terminoPago;

    return idDoc;
  }

  private buildEmisor(ctx: EcfBuildContext): Record<string, unknown> {
    const emisor: Record<string, unknown> = {
      RNCEmisor: ctx.emisor.rnc,
      RazonSocialEmisor: ctx.emisor.razonSocial,
    };
    if (ctx.emisor.nombreComercial) emisor.NombreComercial = ctx.emisor.nombreComercial;
    if (ctx.emisor.direccion) emisor.DireccionEmisor = ctx.emisor.direccion;
    if (ctx.emisor.municipio) emisor.Municipio = ctx.emisor.municipio;
    if (ctx.emisor.provincia) emisor.Provincia = ctx.emisor.provincia;
    if (ctx.emisor.telefono) {
      emisor.TablaTelefonoEmisor = { TelefonoEmisor: [ctx.emisor.telefono] };
    }
    if (ctx.emisor.correo) emisor.CorreoEmisor = ctx.emisor.correo;
    if (ctx.emisor.webSite) emisor.WebSite = ctx.emisor.webSite;
    if (ctx.emisor.actividadEconomica) emisor.ActividadEconomica = ctx.emisor.actividadEconomica;
    if (ctx.emisor.numeroFacturaInterna) {
      emisor.NumeroFacturaInterna = ctx.emisor.numeroFacturaInterna;
    }
    emisor.FechaEmision = ctx.fechaEmision;
    return emisor;
  }

  private buildComprador(ctx: EcfBuildContext): Record<string, unknown> | null {
    const c = ctx.comprador;
    if (!c || !(c.rnc || c.identificadorExtranjero || c.razonSocial)) return null;

    const comprador: Record<string, unknown> = {};
    if (c.rnc) comprador.RNCComprador = c.rnc;
    if (!c.rnc && c.identificadorExtranjero) {
      comprador.IdentificadorExtranjero = c.identificadorExtranjero;
    }
    if (c.razonSocial) comprador.RazonSocialComprador = c.razonSocial;
    if (c.correo) comprador.ContactoComprador = c.correo;
    if (c.direccion) comprador.DireccionComprador = c.direccion;
    if (c.municipio) comprador.MunicipioComprador = c.municipio;
    if (c.provincia) comprador.ProvinciaComprador = c.provincia;
    return comprador;
  }

  private buildInformacionesAdicionales(ctx: EcfBuildContext): Record<string, unknown> | null {
    if (!ctx.emisor.correo) return null;
    return { CorreoEmisor: ctx.emisor.correo };
  }

  private buildTotales(input: {
    buckets: TaxBuckets;
    montoGravadoTotal: number;
    totalItbis: number;
    montoTotal: number;
    descuentoGlobal: number;
    propina: number;
    itbisRetenido: number;
    isrRetenido: number;
  }): Record<string, unknown> {
    const { buckets } = input;
    const totales: Record<string, unknown> = {};

    if (input.montoGravadoTotal > 0) {
      totales.MontoGravadoTotal = this.money(input.montoGravadoTotal);
      if (buckets.montoGravadoI1 > 0) totales.MontoGravadoI1 = this.money(buckets.montoGravadoI1);
      if (buckets.montoGravadoI2 > 0) totales.MontoGravadoI2 = this.money(buckets.montoGravadoI2);
      if (buckets.montoGravadoI3 > 0) totales.MontoGravadoI3 = this.money(buckets.montoGravadoI3);
    }
    if (buckets.montoExento > 0) totales.MontoExento = this.money(buckets.montoExento);

    if (buckets.montoGravadoI1 > 0) totales.ITBIS1 = 18;
    if (buckets.montoGravadoI2 > 0) totales.ITBIS2 = 16;
    if (buckets.montoGravadoI3 > 0) totales.ITBIS3 = 0;

    if (input.totalItbis > 0) {
      totales.TotalITBIS = this.money(input.totalItbis);
      if (buckets.itbis1 > 0) totales.TotalITBIS1 = this.money(buckets.itbis1);
      if (buckets.itbis2 > 0) totales.TotalITBIS2 = this.money(buckets.itbis2);
      if (buckets.itbis3 > 0) totales.TotalITBIS3 = this.money(buckets.itbis3);
    }
    if (buckets.impuestoSelectivo > 0) {
      totales.MontoImpuestoAdicional = this.money(buckets.impuestoSelectivo);
    }
    if (input.descuentoGlobal > 0) totales.MontoNoFacturable = this.money(input.descuentoGlobal);
    if (input.propina > 0) totales.MontoPropinaLegal = this.money(input.propina);

    totales.MontoTotal = this.money(input.montoTotal);

    if (input.itbisRetenido > 0) totales.TotalITBISRetenido = this.money(input.itbisRetenido);
    if (input.isrRetenido > 0) totales.TotalISRRetencion = this.money(input.isrRetenido);

    return totales;
  }

  private buildOtraMoneda(otra: EcfOtraMoneda): Record<string, unknown> {
    const block: Record<string, unknown> = {
      TipoMoneda: otra.tipoMoneda,
      TipoCambio: otra.tipoCambio.toFixed(4),
    };
    if (otra.montoGravadoTotal && otra.montoGravadoTotal > 0) {
      block.MontoGravadoTotalOtraMoneda = this.money(otra.montoGravadoTotal);
    }
    if (otra.montoExento && otra.montoExento > 0) {
      block.MontoExentoOtraMoneda = this.money(otra.montoExento);
    }
    if (otra.totalItbis && otra.totalItbis > 0) {
      block.TotalITBISOtraMoneda = this.money(otra.totalItbis);
    }
    block.MontoTotalOtraMoneda = this.money(otra.montoTotal);
    return block;
  }

  private buildItem(item: EcfItemInput, index: number): Record<string, unknown> {
    const bruto = this.round(item.cantidad * item.precioUnitario);
    const descuento = this.round(item.descuentoMonto ?? 0);
    const monto = this.round(bruto - descuento);

    const line: Record<string, unknown> = {
      NumeroLinea: index + 1,
      IndicadorFacturacion: this.indicadorFacturacion(item),
      NombreItem: item.nombre,
      IndicadorBienoServicio: item.indicadorBienoServicio,
    };
    if (item.descripcion && item.descripcion !== item.nombre) {
      line.DescripcionItem = item.descripcion;
    }
    line.CantidadItem = this.num(item.cantidad);
    if (item.unidadMedida) line.UnidadMedida = item.unidadMedida;
    line.PrecioUnitarioItem = this.money(item.precioUnitario);
    if (descuento > 0) {
      line.DescuentoMonto = this.money(descuento);
      line.TablaSubDescuento = {
        SubDescuento: [
          {
            TipoSubDescuento: '$',
            SubDescuentoPorcentaje: '',
            MontoSubDescuento: this.money(descuento),
          },
        ],
      };
    }
    if (item.montoImpuestoSelectivo && item.montoImpuestoSelectivo > 0) {
      line.MontoImpuestoSelectivoConsumoEspecifico = this.money(item.montoImpuestoSelectivo);
    }
    line.MontoItem = this.money(monto);
    return line;
  }

  // ── Arithmetic ─────────────────────────────────────────────────────────────

  private computeBuckets(items: EcfItemInput[]): TaxBuckets {
    const b: TaxBuckets = {
      montoGravadoI1: 0,
      montoGravadoI2: 0,
      montoGravadoI3: 0,
      montoExento: 0,
      itbis1: 0,
      itbis2: 0,
      itbis3: 0,
      impuestoSelectivo: 0,
    };

    for (const item of items) {
      // Round per line first, so the buckets add up to exactly what the printed document shows.
      const monto = this.round(
        this.round(item.cantidad * item.precioUnitario) - this.round(item.descuentoMonto ?? 0),
      );
      const excise = this.round(item.montoImpuestoSelectivo ?? 0);
      b.impuestoSelectivo = this.round(b.impuestoSelectivo + excise);

      if (this.approx(item.itbisTasa, EcfXmlBuilderService.ITBIS_I1)) {
        b.montoGravadoI1 = this.round(b.montoGravadoI1 + monto);
        b.itbis1 = this.round(b.itbis1 + (monto + excise) * EcfXmlBuilderService.ITBIS_I1);
      } else if (this.approx(item.itbisTasa, EcfXmlBuilderService.ITBIS_I2)) {
        b.montoGravadoI2 = this.round(b.montoGravadoI2 + monto);
        b.itbis2 = this.round(b.itbis2 + (monto + excise) * EcfXmlBuilderService.ITBIS_I2);
      } else if (item.exento) {
        b.montoExento = this.round(b.montoExento + monto);
      } else {
        // Zero-rated: taxed at 0 % WITH the right to deduct — an export, not an exemption.
        b.montoGravadoI3 = this.round(b.montoGravadoI3 + monto);
      }
    }
    return b;
  }

  /** 1 = gravado 18 %, 2 = gravado 16 %, 3 = gravado 0 % (tasa cero), 4 = exento. */
  private indicadorFacturacion(item: EcfItemInput): number {
    if (this.approx(item.itbisTasa, EcfXmlBuilderService.ITBIS_I1)) return 1;
    if (this.approx(item.itbisTasa, EcfXmlBuilderService.ITBIS_I2)) return 2;
    return item.exento ? 4 : 3;
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
    return Number.isInteger(n) ? String(n) : String(Math.round((n + Number.EPSILON) * 1e6) / 1e6);
  }

  private fechaHoraFirma(fechaEmision: string): string {
    return `${fechaEmision} 00:00:00`;
  }

  /**
   * The document total this builder will emit, computed the same way `build` computes it.
   *
   * Exposed so the QR URL and the printed representation quote ONE number. They used to be computed
   * independently — `buildQrUrl` summed line by line while the builder rounded per bucket — so with
   * enough lines the QR could carry a total that differed by cents from the comprobante it points
   * at, and the DGII's timbre lookup would not resolve.
   */
  montoTotal(ctx: EcfBuildContext): number {
    const buckets = this.computeBuckets(ctx.items);
    const montoGravadoTotal = this.round(
      buckets.montoGravadoI1 + buckets.montoGravadoI2 + buckets.montoGravadoI3,
    );
    const totalItbis = this.round(buckets.itbis1 + buckets.itbis2 + buckets.itbis3);
    return this.round(
      montoGravadoTotal +
        buckets.montoExento +
        totalItbis +
        buckets.impuestoSelectivo +
        this.round(ctx.montoPropinaLegal ?? 0) -
        this.round(ctx.descuentoGlobal ?? 0),
    );
  }
}
