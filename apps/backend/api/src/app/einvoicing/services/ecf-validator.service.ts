import { Injectable } from '@nestjs/common';
import { EcfBuildContext } from './ecf-xml-builder.service';

export interface EcfValidationIssue {
  /** The element or rule the document fails. Always the DGII's own element name, never translated. */
  field: string;
  /**
   * A catalogue key, not a sentence.
   *
   * A rejected comprobante is read by whoever is trying to issue it, and an accounting department
   * in São Paulo running a Dominican subsidiary reads Portuguese. The DGII's element names stay as
   * the authority publishes them — `RNCComprador` is an identifier, not vocabulary — and the
   * explanation around them follows the reader.
   */
  messageKey: string;
  /** Interpolation values. Data — an amount, a code, a line number — never prose. */
  params?: Record<string, unknown>;
}

export class EcfValidationError extends Error {
  constructor(public readonly issues: EcfValidationIssue[]) {
    // The `Error` message is for the log and the stack trace, so it stays machine-readable and
    // untranslated. What the tenant sees is built from `issues` by the caller, in their language.
    super(
      `e-CF rejected by pre-flight validation: ${issues
        .map((i) => `${i.field} (${i.messageKey})`)
        .join('; ')}`,
    );
    this.name = 'EcfValidationError';
  }
}

/**
 * Checks a document against the DGII's e-CF rules BEFORE it is signed and transmitted.
 *
 * ## Why a validator, and why this one
 *
 * There was none. Every comprobante went to the DGII unchecked, so the first time a tenant learned
 * that its address was missing, or that a credit-fiscal invoice had no buyer RNC, was when the
 * document came back rejected — with the e-NCF already consumed and a customer waiting.
 *
 * This is a structural and business-rule validator, not an XSD parser. That is a deliberate choice:
 * the DGII versions its XSD per document type and per environment, and a validator pinned to one
 * copy of a schema goes stale silently. What is encoded here are the rules that do not move — which
 * elements are mandatory for which document type, which identifiers must be well-formed, which
 * totals must agree — expressed so a failure names the field and says what to do about it.
 *
 * Where an operator's authorized environment does publish an XSD, this runs first and catches the
 * common cases with a useful message; the schema remains the authority.
 */
@Injectable()
export class EcfValidatorService {
  /** Document types that must carry the buyer's RNC and legal name. */
  private static readonly REQUIRES_BUYER_TAX_ID = new Set(['31', '33', '34', '44', '45']);
  /** Consumo: the buyer's RNC becomes mandatory above this amount. */
  private static readonly CONSUMO_BUYER_THRESHOLD = 250_000;

  /** Throws {@link EcfValidationError} when the document cannot be accepted. */
  assertValid(ctx: EcfBuildContext, montoTotal: number): void {
    const issues = this.validate(ctx, montoTotal);
    if (issues.length > 0) throw new EcfValidationError(issues);
  }

  validate(ctx: EcfBuildContext, montoTotal: number): EcfValidationIssue[] {
    const issues: EcfValidationIssue[] = [];

    // ── Identification ───────────────────────────────────────────────────────
    if (!/^E\d{12}$/.test(ctx.eNCF)) {
      issues.push({
        field: 'eNCF',
        messageKey: 'EINVOICING.ENCF_BAD_FORMAT',
        params: { value: ctx.eNCF },
      });
    }
    if (!/^\d{2}$/.test(ctx.tipoECF)) {
      issues.push({ field: 'TipoeCF', messageKey: 'EINVOICING.TIPO_COMPROBANTE_DEBE_DOS_DIGITOS' });
    }
    if (ctx.eNCF.substring(1, 3) !== ctx.tipoECF) {
      issues.push({
        field: 'eNCF',
        messageKey: 'EINVOICING.ENCF_TYPE_MISMATCH',
        params: { declared: ctx.tipoECF, encoded: ctx.eNCF.substring(1, 3) },
      });
    }
    if (!ctx.fechaVencimientoSecuencia) {
      issues.push({
        field: 'FechaVencimientoSecuencia',
        messageKey: 'EINVOICING.AUTORIZACION_RANGO_NO_TIENE_FECHA_VENCIMIENTO_REGISTRADA_ANADELA',
      });
    }

    // ── Dates ────────────────────────────────────────────────────────────────
    if (!this.isDgiiDate(ctx.fechaEmision)) {
      issues.push({ field: 'FechaEmision', messageKey: 'EINVOICING.FECHA_DEBE_TENER_FORMATO_DD_MM_AAAA' });
    }
    if (ctx.fechaVencimientoSecuencia && !this.isDgiiDate(ctx.fechaVencimientoSecuencia)) {
      issues.push({
        field: 'FechaVencimientoSecuencia',
        messageKey: 'EINVOICING.FECHA_DEBE_TENER_FORMATO_DD_MM_AAAA',
      });
    }
    if (ctx.fechaHoraFirma && !/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(ctx.fechaHoraFirma)) {
      issues.push({
        field: 'FechaHoraFirma',
        messageKey: 'EINVOICING.DEBE_TENER_FORMATO_DD_MM_AAAA_HH_MM',
      });
    }

    // ── Issuer ───────────────────────────────────────────────────────────────
    if (!this.isDominicanTaxId(ctx.emisor.rnc)) {
      issues.push({
        field: 'RNCEmisor',
        messageKey: 'EINVOICING.RNC_EMISOR_DEBE_TENER_9_U_11_DIGITOS',
      });
    }
    if (!ctx.emisor.razonSocial?.trim()) {
      issues.push({ field: 'RazonSocialEmisor', messageKey: 'EINVOICING.RAZON_SOCIAL_EMISOR_OBLIGATORIA' });
    }
    if (!ctx.emisor.direccion?.trim()) {
      issues.push({
        field: 'DireccionEmisor',
        messageKey: 'EINVOICING.DIRECCION_FISCAL_EMISOR_OBLIGATORIA_COMPLETALA_AJUSTES_EMPRESA',
      });
    }
    if (ctx.emisor.provincia && !/^\d{2}$/.test(ctx.emisor.provincia)) {
      issues.push({
        field: 'Provincia',
        messageKey: 'EINVOICING.PROVINCIA_DEBE_DECLARARSE_CON_CODIGO_DOS_DIGITOS_DGII',
      });
    }
    if (ctx.emisor.municipio && !/^\d{4}$/.test(ctx.emisor.municipio)) {
      issues.push({
        field: 'Municipio',
        messageKey: 'EINVOICING.MUNICIPIO_DEBE_DECLARARSE_CON_CODIGO_CUATRO_DIGITOS_DGII',
      });
    }

    // ── Buyer ────────────────────────────────────────────────────────────────
    const buyerTaxId = ctx.comprador?.rnc ?? '';
    if (EcfValidatorService.REQUIRES_BUYER_TAX_ID.has(ctx.tipoECF)) {
      if (!buyerTaxId && !ctx.comprador?.identificadorExtranjero) {
        issues.push({
          field: 'RNCComprador',
          messageKey: 'EINVOICING.BUYER_TAX_ID_REQUIRED_FOR_TYPE',
          params: { type: ctx.tipoECF },
        });
      } else if (buyerTaxId && !this.isDominicanTaxId(buyerTaxId)) {
        issues.push({
          field: 'RNCComprador',
          messageKey: 'EINVOICING.RNC_CEDULA_COMPRADOR_DEBE_TENER_9_U_11',
        });
      }
      if (!ctx.comprador?.razonSocial?.trim()) {
        issues.push({
          field: 'RazonSocialComprador',
          messageKey: 'EINVOICING.BUYER_LEGAL_NAME_REQUIRED_FOR_TYPE',
          params: { type: ctx.tipoECF },
        });
      }
    }
    // Consumo above the threshold must identify the buyer — a DGII rule that is easy to breach
    // silently, because the same screen issues both amounts.
    if (
      ctx.tipoECF === '32' &&
      montoTotal >= EcfValidatorService.CONSUMO_BUYER_THRESHOLD &&
      !buyerTaxId
    ) {
      issues.push({
        field: 'RNCComprador',
        messageKey: 'EINVOICING.CONSUMO_ABOVE_THRESHOLD_REQUIRES_BUYER',
        // Amounts travel as numbers with their currency, so the catalogue's `money` formatting
        // renders them in the reader's locale rather than in `es-DO` for everybody.
        params: {
          amount: montoTotal,
          threshold: EcfValidatorService.CONSUMO_BUYER_THRESHOLD,
          currency: 'DOP',
        },
      });
    }
    // Exports must be billed to a party outside the country.
    if (ctx.tipoECF === '46' && !ctx.comprador?.identificadorExtranjero && !buyerTaxId) {
      issues.push({
        field: 'IdentificadorExtranjero',
        messageKey: 'EINVOICING.COMPROBANTE_EXPORTACION_REQUIERE_IDENTIFICAR_COMPRADOR_EXTRANJERO',
      });
    }

    // ── Payment ──────────────────────────────────────────────────────────────
    if (!['1', '2', '3'].includes(ctx.tipoPago)) {
      issues.push({ field: 'TipoPago', messageKey: 'EINVOICING.TIPO_PAGO_DEBE_1_CONTADO_2_CREDITO' });
    }
    if (ctx.tipoPago === '1' && (!ctx.formasPago || ctx.formasPago.length === 0)) {
      issues.push({
        field: 'TablaFormasPago',
        messageKey: 'EINVOICING.VENTA_CONTADO_DEBE_DECLARAR_MENOS_FORMA_PAGO',
      });
    }
    if (ctx.formasPago) {
      const declared = round2(ctx.formasPago.reduce((sum, p) => sum + p.monto, 0));
      if (Math.abs(declared - round2(montoTotal)) > 0.05) {
        issues.push({
          field: 'TablaFormasPago',
          messageKey: 'EINVOICING.PAYMENTS_DO_NOT_MATCH_TOTAL',
          params: { declared, total: montoTotal, currency: 'DOP' },
        });
      }
      for (const pago of ctx.formasPago) {
        if (!/^0[1-7]$/.test(pago.forma)) {
          issues.push({
            field: 'FormaPago',
            messageKey: 'EINVOICING.PAYMENT_METHOD_CODE_UNKNOWN',
            params: { value: pago.forma },
          });
        }
      }
    }

    // ── Items ────────────────────────────────────────────────────────────────
    if (!ctx.items || ctx.items.length === 0) {
      issues.push({ field: 'DetallesItems', messageKey: 'EINVOICING.COMPROBANTE_DEBE_TENER_MENOS_LINEA' });
    }
    ctx.items?.forEach((item, index) => {
      // The line number is a parameter, not a prefix: "línea 3: …" and "line 3: …" put the
      // number in the same place, but a language that does not would have no way to move it.
      const line = index + 1;
      if (!item.nombre?.trim()) {
        issues.push({ field: 'NombreItem', messageKey: 'EINVOICING.ITEM_NAME_REQUIRED', params: { line } });
      }
      if (!(item.cantidad > 0)) {
        issues.push({
          field: 'CantidadItem',
          messageKey: 'EINVOICING.ITEM_QUANTITY_MUST_BE_POSITIVE',
          params: { line },
        });
      }
      if (!(item.precioUnitario >= 0)) {
        issues.push({
          field: 'PrecioUnitarioItem',
          messageKey: 'EINVOICING.ITEM_PRICE_MUST_NOT_BE_NEGATIVE',
          params: { line },
        });
      }
      if (!['1', '2'].includes(item.indicadorBienoServicio)) {
        issues.push({
          field: 'IndicadorBienoServicio',
          messageKey: 'EINVOICING.ITEM_MUST_DECLARE_GOOD_OR_SERVICE',
          params: { line },
        });
      }
      if (![0, 0.16, 0.18].some((rate) => Math.abs(rate - item.itbisTasa) < 1e-6)) {
        issues.push({
          field: 'IndicadorFacturacion',
          messageKey: 'EINVOICING.ITEM_TAX_RATE_NOT_IN_FORCE',
          params: { line, rate: item.itbisTasa },
        });
      }
    });

    // ── Notes ────────────────────────────────────────────────────────────────
    if (['33', '34'].includes(ctx.tipoECF)) {
      if (!ctx.modifica?.eNCFModificado) {
        issues.push({
          field: 'InformacionReferencia',
          messageKey: 'EINVOICING.NOTA_CREDITO_DEBITO_DEBE_REFERENCIAR_COMPROBANTE_MODIFICA',
        });
      } else if (!/^[EB]\d{8,12}$/.test(ctx.modifica.eNCFModificado)) {
        issues.push({
          field: 'NCFModificado',
          messageKey: 'EINVOICING.MODIFIED_NCF_BAD_FORMAT',
          params: { value: ctx.modifica.eNCFModificado },
        });
      }
      if (ctx.modifica && !/^[1-5]$/.test(ctx.modifica.codigoModificacion)) {
        issues.push({
          field: 'CodigoModificacion',
          messageKey: 'EINVOICING.CODIGO_MODIFICACION_DEBE_ESTAR_ENTRE_1_5',
        });
      }
    }

    // ── Foreign currency ─────────────────────────────────────────────────────
    if (ctx.otraMoneda) {
      if (!/^[A-Z]{3}$/.test(ctx.otraMoneda.tipoMoneda)) {
        issues.push({ field: 'TipoMoneda', messageKey: 'EINVOICING.CODIGO_MONEDA_DEBE_ISO_4217' });
      }
      if (!(ctx.otraMoneda.tipoCambio > 0)) {
        issues.push({ field: 'TipoCambio', messageKey: 'EINVOICING.TASA_CAMBIO_DEBE_MAYOR_CERO' });
      }
    }

    if (!(montoTotal > 0)) {
      issues.push({ field: 'MontoTotal', messageKey: 'EINVOICING.TOTAL_COMPROBANTE_DEBE_MAYOR_CERO' });
    }

    return issues;
  }

  private isDgiiDate(value: string): boolean {
    if (!/^\d{2}-\d{2}-\d{4}$/.test(value)) return false;
    const [day, month, year] = value.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1) return false;
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  private isDominicanTaxId(value: string): boolean {
    const digits = (value ?? '').replace(/\D/g, '');
    return digits.length === 9 || digits.length === 11;
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
