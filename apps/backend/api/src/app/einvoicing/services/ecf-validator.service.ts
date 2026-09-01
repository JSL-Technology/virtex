import { Injectable } from '@nestjs/common';
import { EcfBuildContext } from './ecf-xml-builder.service';

export interface EcfValidationIssue {
  /** The element or rule the document fails. */
  field: string;
  message: string;
}

export class EcfValidationError extends Error {
  constructor(public readonly issues: EcfValidationIssue[]) {
    super(
      `El comprobante no cumple el formato de la DGII: ${issues
        .map((i) => `${i.field} — ${i.message}`)
        .join('; ')}.`,
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
        message: `"${ctx.eNCF}" no tiene el formato de un e-NCF (E + 12 dígitos)`,
      });
    }
    if (!/^\d{2}$/.test(ctx.tipoECF)) {
      issues.push({ field: 'TipoeCF', message: 'el tipo de comprobante debe ser de dos dígitos' });
    }
    if (ctx.eNCF.substring(1, 3) !== ctx.tipoECF) {
      issues.push({
        field: 'eNCF',
        message: `el tipo declarado (${ctx.tipoECF}) no coincide con el del e-NCF (${ctx.eNCF.substring(1, 3)})`,
      });
    }
    if (!ctx.fechaVencimientoSecuencia) {
      issues.push({
        field: 'FechaVencimientoSecuencia',
        message:
          'la autorización del rango no tiene fecha de vencimiento registrada; añádela en Ajustes → Facturación Electrónica',
      });
    }

    // ── Dates ────────────────────────────────────────────────────────────────
    if (!this.isDgiiDate(ctx.fechaEmision)) {
      issues.push({ field: 'FechaEmision', message: 'la fecha debe tener el formato DD-MM-AAAA' });
    }
    if (ctx.fechaVencimientoSecuencia && !this.isDgiiDate(ctx.fechaVencimientoSecuencia)) {
      issues.push({
        field: 'FechaVencimientoSecuencia',
        message: 'la fecha debe tener el formato DD-MM-AAAA',
      });
    }
    if (ctx.fechaHoraFirma && !/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(ctx.fechaHoraFirma)) {
      issues.push({
        field: 'FechaHoraFirma',
        message: 'debe tener el formato DD-MM-AAAA HH:MM:SS',
      });
    }

    // ── Issuer ───────────────────────────────────────────────────────────────
    if (!this.isDominicanTaxId(ctx.emisor.rnc)) {
      issues.push({
        field: 'RNCEmisor',
        message: 'el RNC del emisor debe tener 9 u 11 dígitos; revísalo en los datos de la empresa',
      });
    }
    if (!ctx.emisor.razonSocial?.trim()) {
      issues.push({ field: 'RazonSocialEmisor', message: 'la razón social del emisor es obligatoria' });
    }
    if (!ctx.emisor.direccion?.trim()) {
      issues.push({
        field: 'DireccionEmisor',
        message: 'la dirección fiscal del emisor es obligatoria; complétala en Ajustes → Empresa',
      });
    }
    if (ctx.emisor.provincia && !/^\d{2}$/.test(ctx.emisor.provincia)) {
      issues.push({
        field: 'Provincia',
        message: 'la provincia debe declararse con el código de dos dígitos de la DGII',
      });
    }
    if (ctx.emisor.municipio && !/^\d{4}$/.test(ctx.emisor.municipio)) {
      issues.push({
        field: 'Municipio',
        message: 'el municipio debe declararse con el código de cuatro dígitos de la DGII',
      });
    }

    // ── Buyer ────────────────────────────────────────────────────────────────
    const buyerTaxId = ctx.comprador?.rnc ?? '';
    if (EcfValidatorService.REQUIRES_BUYER_TAX_ID.has(ctx.tipoECF)) {
      if (!buyerTaxId && !ctx.comprador?.identificadorExtranjero) {
        issues.push({
          field: 'RNCComprador',
          message: `un comprobante tipo ${ctx.tipoECF} requiere el RNC o cédula del comprador`,
        });
      } else if (buyerTaxId && !this.isDominicanTaxId(buyerTaxId)) {
        issues.push({
          field: 'RNCComprador',
          message: 'el RNC o cédula del comprador debe tener 9 u 11 dígitos',
        });
      }
      if (!ctx.comprador?.razonSocial?.trim()) {
        issues.push({
          field: 'RazonSocialComprador',
          message: `un comprobante tipo ${ctx.tipoECF} requiere la razón social del comprador`,
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
        message:
          `una factura de consumo por RD$${montoTotal.toFixed(2)} supera el umbral de ` +
          `RD$${EcfValidatorService.CONSUMO_BUYER_THRESHOLD.toLocaleString('es-DO')} y requiere identificar al comprador`,
      });
    }
    // Exports must be billed to a party outside the country.
    if (ctx.tipoECF === '46' && !ctx.comprador?.identificadorExtranjero && !buyerTaxId) {
      issues.push({
        field: 'IdentificadorExtranjero',
        message: 'un comprobante de exportación requiere identificar al comprador extranjero',
      });
    }

    // ── Payment ──────────────────────────────────────────────────────────────
    if (!['1', '2', '3'].includes(ctx.tipoPago)) {
      issues.push({ field: 'TipoPago', message: 'el tipo de pago debe ser 1 (contado) o 2 (crédito)' });
    }
    if (ctx.tipoPago === '1' && (!ctx.formasPago || ctx.formasPago.length === 0)) {
      issues.push({
        field: 'TablaFormasPago',
        message: 'una venta al contado debe declarar al menos una forma de pago',
      });
    }
    if (ctx.formasPago) {
      const declared = round2(ctx.formasPago.reduce((sum, p) => sum + p.monto, 0));
      if (Math.abs(declared - round2(montoTotal)) > 0.05) {
        issues.push({
          field: 'TablaFormasPago',
          message: `las formas de pago suman ${declared.toFixed(2)} y el total del comprobante es ${montoTotal.toFixed(2)}`,
        });
      }
      for (const pago of ctx.formasPago) {
        if (!/^0[1-7]$/.test(pago.forma)) {
          issues.push({
            field: 'FormaPago',
            message: `"${pago.forma}" no es un código de forma de pago de la DGII`,
          });
        }
      }
    }

    // ── Items ────────────────────────────────────────────────────────────────
    if (!ctx.items || ctx.items.length === 0) {
      issues.push({ field: 'DetallesItems', message: 'el comprobante debe tener al menos una línea' });
    }
    ctx.items?.forEach((item, index) => {
      const position = `línea ${index + 1}`;
      if (!item.nombre?.trim()) {
        issues.push({ field: 'NombreItem', message: `${position}: falta la descripción del artículo` });
      }
      if (!(item.cantidad > 0)) {
        issues.push({ field: 'CantidadItem', message: `${position}: la cantidad debe ser mayor que cero` });
      }
      if (!(item.precioUnitario >= 0)) {
        issues.push({
          field: 'PrecioUnitarioItem',
          message: `${position}: el precio unitario no puede ser negativo`,
        });
      }
      if (!['1', '2'].includes(item.indicadorBienoServicio)) {
        issues.push({
          field: 'IndicadorBienoServicio',
          message: `${position}: debe declararse como bien (1) o servicio (2)`,
        });
      }
      if (![0, 0.16, 0.18].some((rate) => Math.abs(rate - item.itbisTasa) < 1e-6)) {
        issues.push({
          field: 'IndicadorFacturacion',
          message: `${position}: la tasa ${(item.itbisTasa * 100).toFixed(2)}% no es una tasa de ITBIS vigente`,
        });
      }
    });

    // ── Notes ────────────────────────────────────────────────────────────────
    if (['33', '34'].includes(ctx.tipoECF)) {
      if (!ctx.modifica?.eNCFModificado) {
        issues.push({
          field: 'InformacionReferencia',
          message: 'una nota de crédito o débito debe referenciar el comprobante que modifica',
        });
      } else if (!/^[EB]\d{8,12}$/.test(ctx.modifica.eNCFModificado)) {
        issues.push({
          field: 'NCFModificado',
          message: `"${ctx.modifica.eNCFModificado}" no tiene el formato de un NCF`,
        });
      }
      if (ctx.modifica && !/^[1-5]$/.test(ctx.modifica.codigoModificacion)) {
        issues.push({
          field: 'CodigoModificacion',
          message: 'el código de modificación debe estar entre 1 y 5',
        });
      }
    }

    // ── Foreign currency ─────────────────────────────────────────────────────
    if (ctx.otraMoneda) {
      if (!/^[A-Z]{3}$/.test(ctx.otraMoneda.tipoMoneda)) {
        issues.push({ field: 'TipoMoneda', message: 'el código de moneda debe ser ISO 4217' });
      }
      if (!(ctx.otraMoneda.tipoCambio > 0)) {
        issues.push({ field: 'TipoCambio', message: 'la tasa de cambio debe ser mayor que cero' });
      }
    }

    if (!(montoTotal > 0)) {
      issues.push({ field: 'MontoTotal', message: 'el total del comprobante debe ser mayor que cero' });
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
