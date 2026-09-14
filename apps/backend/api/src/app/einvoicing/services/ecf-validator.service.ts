import { Injectable } from '@nestjs/common';
import { EcfBuildContext } from './ecf-xml-builder.service';
import { roundAmount } from '../../common/money';

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
        messageKey: 'einvoicing.value_not_ncf_format_12_digits',
        params: { value: ctx.eNCF },
      });
    }
    if (!/^\d{2}$/.test(ctx.tipoECF)) {
      issues.push({ field: 'TipoeCF', messageKey: 'einvoicing.document_type_must_two_digits' });
    }
    if (ctx.eNCF.substring(1, 3) !== ctx.tipoECF) {
      issues.push({
        field: 'eNCF',
        messageKey: 'einvoicing.encf_type_mismatch',
        params: { declared: ctx.tipoECF, encoded: ctx.eNCF.substring(1, 3) },
      });
    }
    if (!ctx.fechaVencimientoSecuencia) {
      issues.push({
        field: 'FechaVencimientoSecuencia',
        messageKey: 'einvoicing.range_authorization_has_no_expiry_date',
      });
    }

    // ── Dates ────────────────────────────────────────────────────────────────
    if (!this.isDgiiDate(ctx.fechaEmision)) {
      issues.push({ field: 'FechaEmision', messageKey: 'einvoicing.date_must_dd_mm_yyyy_format' });
    }
    if (ctx.fechaVencimientoSecuencia && !this.isDgiiDate(ctx.fechaVencimientoSecuencia)) {
      issues.push({
        field: 'FechaVencimientoSecuencia',
        messageKey: 'einvoicing.date_must_dd_mm_yyyy_format',
      });
    }
    if (ctx.fechaHoraFirma && !/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(ctx.fechaHoraFirma)) {
      issues.push({
        field: 'FechaHoraFirma',
        messageKey: 'einvoicing.must_dd_mm_yyyy_hh_mm',
      });
    }

    // ── Issuer ───────────────────────────────────────────────────────────────
    if (!this.isDominicanTaxId(ctx.emisor.rnc)) {
      issues.push({
        field: 'RNCEmisor',
        messageKey: 'einvoicing.issuer_rnc_must_have_11_digits',
      });
    }
    if (!ctx.emisor.razonSocial?.trim()) {
      issues.push({ field: 'RazonSocialEmisor', messageKey: 'einvoicing.issuer_legal_name_required' });
    }
    if (!ctx.emisor.direccion?.trim()) {
      issues.push({
        field: 'DireccionEmisor',
        messageKey: 'einvoicing.issuer_registered_address_required_fill_under',
      });
    }
    if (ctx.emisor.provincia && !/^\d{2}$/.test(ctx.emisor.provincia)) {
      issues.push({
        field: 'Provincia',
        messageKey: 'einvoicing.province_must_declared_with_dgii_two',
      });
    }
    if (ctx.emisor.municipio && !/^\d{4}$/.test(ctx.emisor.municipio)) {
      issues.push({
        field: 'Municipio',
        messageKey: 'einvoicing.municipality_must_declared_with_dgii_four',
      });
    }

    // ── Buyer ────────────────────────────────────────────────────────────────
    const buyerTaxId = ctx.comprador?.rnc ?? '';
    if (EcfValidatorService.REQUIRES_BUYER_TAX_ID.has(ctx.tipoECF)) {
      if (!buyerTaxId && !ctx.comprador?.identificadorExtranjero) {
        issues.push({
          field: 'RNCComprador',
          messageKey: 'einvoicing.buyer_tax_id_required_for_type',
          params: { type: ctx.tipoECF },
        });
      } else if (buyerTaxId && !this.isDominicanTaxId(buyerTaxId)) {
        issues.push({
          field: 'RNCComprador',
          messageKey: 'einvoicing.buyer_rnc_national_id_must_have',
        });
      }
      if (!ctx.comprador?.razonSocial?.trim()) {
        issues.push({
          field: 'RazonSocialComprador',
          messageKey: 'einvoicing.buyer_legal_name_required_for_type',
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
        messageKey: 'einvoicing.consumo_above_threshold_requires_buyer',
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
        messageKey: 'einvoicing.export_document_requires_foreign_buyer_identified',
      });
    }

    // ── Payment ──────────────────────────────────────────────────────────────
    if (!['1', '2', '3'].includes(ctx.tipoPago)) {
      issues.push({ field: 'TipoPago', messageKey: 'einvoicing.payment_type_must_cash_credit' });
    }
    if (ctx.tipoPago === '1' && (!ctx.formasPago || ctx.formasPago.length === 0)) {
      issues.push({
        field: 'TablaFormasPago',
        messageKey: 'einvoicing.cash_sale_must_declare_least_one',
      });
    }
    if (ctx.formasPago) {
      const declared = round2(ctx.formasPago.reduce((sum, p) => sum + p.monto, 0));
      if (Math.abs(declared - round2(montoTotal)) > 0.05) {
        issues.push({
          field: 'TablaFormasPago',
          messageKey: 'einvoicing.payments_do_not_match_total',
          params: { declared, total: montoTotal, currency: 'DOP' },
        });
      }
      for (const pago of ctx.formasPago) {
        if (!/^0[1-7]$/.test(pago.forma)) {
          issues.push({
            field: 'FormaPago',
            messageKey: 'einvoicing.payment_method_code_unknown',
            params: { value: pago.forma },
          });
        }
      }
    }

    // ── Items ────────────────────────────────────────────────────────────────
    if (!ctx.items || ctx.items.length === 0) {
      issues.push({ field: 'DetallesItems', messageKey: 'einvoicing.document_must_have_least_one_line' });
    }
    ctx.items?.forEach((item, index) => {
      // The line number is a parameter, not a prefix: "línea 3: …" and "line 3: …" put the
      // number in the same place, but a language that does not would have no way to move it.
      const line = index + 1;
      if (!item.nombre?.trim()) {
        issues.push({ field: 'NombreItem', messageKey: 'einvoicing.item_name_required', params: { line } });
      }
      if (!(item.cantidad > 0)) {
        issues.push({
          field: 'CantidadItem',
          messageKey: 'einvoicing.item_quantity_must_be_positive',
          params: { line },
        });
      }
      if (!(item.precioUnitario >= 0)) {
        issues.push({
          field: 'PrecioUnitarioItem',
          messageKey: 'einvoicing.item_price_must_not_be_negative',
          params: { line },
        });
      }
      if (!['1', '2'].includes(item.indicadorBienoServicio)) {
        issues.push({
          field: 'IndicadorBienoServicio',
          messageKey: 'einvoicing.item_must_declare_good_or_service',
          params: { line },
        });
      }
      if (![0, 0.16, 0.18].some((rate) => Math.abs(rate - item.itbisTasa) < 1e-6)) {
        issues.push({
          field: 'IndicadorFacturacion',
          messageKey: 'einvoicing.item_tax_rate_not_in_force',
          params: { line, rate: item.itbisTasa },
        });
      }
    });

    // ── Notes ────────────────────────────────────────────────────────────────
    if (['33', '34'].includes(ctx.tipoECF)) {
      if (!ctx.modifica?.eNCFModificado) {
        issues.push({
          field: 'InformacionReferencia',
          messageKey: 'einvoicing.credit_debit_note_must_reference_document',
        });
      } else if (!/^[EB]\d{8,12}$/.test(ctx.modifica.eNCFModificado)) {
        issues.push({
          field: 'NCFModificado',
          messageKey: 'einvoicing.value_not_ncf_format',
          params: { value: ctx.modifica.eNCFModificado },
        });
      }
      if (ctx.modifica && !/^[1-5]$/.test(ctx.modifica.codigoModificacion)) {
        issues.push({
          field: 'CodigoModificacion',
          messageKey: 'einvoicing.modification_code_must_between',
        });
      }
    }

    // ── Foreign currency ─────────────────────────────────────────────────────
    if (ctx.otraMoneda) {
      if (!/^[A-Z]{3}$/.test(ctx.otraMoneda.tipoMoneda)) {
        issues.push({ field: 'TipoMoneda', messageKey: 'einvoicing.currency_code_must_iso_4217' });
      }
      if (!(ctx.otraMoneda.tipoCambio > 0)) {
        issues.push({ field: 'TipoCambio', messageKey: 'einvoicing.exchange_rate_must_greater_than_zero' });
      }
    }

    if (!(montoTotal > 0)) {
      issues.push({ field: 'MontoTotal', messageKey: 'einvoicing.document_total_must_greater_than_zero' });
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
  return roundAmount(value);
}
