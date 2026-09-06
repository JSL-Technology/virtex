import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { roundToCurrency } from '../../../common/money';
import { BadRequestError } from '../../../i18n/localized.exception';

/**
 * Argentina — AFIP, WSFEv1.
 *
 * ## Why this one looks nothing like the other six
 *
 * Argentina does not receive a document. The other regimes build an XML, sign it and send it; AFIP
 * takes a **structure of fields** through a SOAP method (`FECAESolicitar`) and answers with a
 * *CAE* — Código de Autorización Electrónico — plus its expiry. The taxpayer then prints or sends
 * whatever they like, as long as it carries the CAE. So there is no document to seal here: the
 * signature happens one level up, in the authentication.
 *
 * That authentication is the other peculiarity. `WSAA` takes a CMS/PKCS#7 signed *login ticket
 * request*, signed with the taxpayer's certificate, and returns a token and a signature valid for
 * twelve hours which every business call then carries. Two services, two protocols, one
 * certificate — and a ticket requested twice inside its validity window is rejected, so the ticket
 * has to be cached rather than requested per document.
 *
 * *Verificar con contabilidad/legal*: `CbteTipo` (1 factura A, 6 factura B, 11 factura C, 3/8/13
 * notas de crédito) depends on the seller's and buyer's VAT condition, and `Concepto` (1 productos,
 * 2 servicios, 3 ambos) on what was sold. Both come from the tenant's fiscal profile and the
 * document, and neither is guessed here.
 */
export interface AfipBuildInput {
  invoice: Invoice;
  organization: Organization;
  customer: Customer;
  /** Punto de venta, four digits, assigned by AFIP per establishment. */
  salesPoint: number;
  /** The seller's VAT condition, which decides whether an A, B or C invoice is issued. */
  issuerVatCondition: 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO';
  /** The number AFIP expects next in this point of sale and document type. */
  nextNumber: number;
}

/** What `FECAESolicitar` receives. Field names are AFIP's own, so they read against its manual. */
export interface AfipRequest {
  FeCabReq: { CantReg: number; PtoVta: number; CbteTipo: number };
  FeDetReq: {
    Concepto: number;
    DocTipo: number;
    DocNro: number;
    CbteDesde: number;
    CbteHasta: number;
    CbteFch: string;
    ImpTotal: number;
    ImpTotConc: number;
    ImpNeto: number;
    ImpOpEx: number;
    ImpIVA: number;
    ImpTrib: number;
    MonId: string;
    MonCotiz: number;
    Iva?: { Id: number; BaseImp: number; Importe: number }[];
  }[];
}

export class AfipBuilder {
  /**
   * The request, and the barcode the printed document has to carry.
   *
   * AFIP's barcode is CUIT + document type + point of sale + CAE + CAE expiry + a modulus-10
   * check digit, and it is what an inspector reads off a printed invoice. The CAE is not known
   * until AFIP answers, so it is computed afterwards from the response.
   */
  build(input: AfipBuildInput): AfipRequest {
    this.assertIssuable(input);
    const { invoice } = input;
    const currency = invoice.currencyCode ?? 'ARS';
    const round = (value: number) => roundToCurrency(value, currency);

    const net = round(invoice.taxedTotal ?? invoice.subtotal);
    const exempt = round(invoice.exemptTotal ?? 0);
    const vat = round(invoice.tax ?? 0);

    return {
      FeCabReq: {
        CantReg: 1,
        PtoVta: input.salesPoint,
        CbteTipo: this.documentType(input),
      },
      FeDetReq: [
        {
          // `1` productos, `2` servicios, `3` ambos. A services document also needs the service
          // period dates, which AFIP validates against the issue date.
          Concepto: this.concept(invoice),
          DocTipo: this.buyerDocumentType(input.customer),
          DocNro: Number((input.customer.taxId ?? '0').replace(/\D/g, '')) || 0,
          CbteDesde: input.nextNumber,
          CbteHasta: input.nextNumber,
          CbteFch: this.yyyymmdd(invoice.issueDate),
          ImpTotal: round(invoice.total),
          // Net not subject to tax — a concept outside VAT's scope, which is not the same as
          // exempt and AFIP reconciles them separately.
          ImpTotConc: 0,
          ImpNeto: net,
          ImpOpEx: exempt,
          ImpIVA: vat,
          // Other taxes: internal taxes and municipal charges, which ride separately from VAT.
          ImpTrib: round(invoice.excise ?? 0),
          MonId: currency === 'ARS' ? 'PES' : this.currencyCode(currency),
          MonCotiz: currency === 'ARS' ? 1 : Number(invoice.exchangeRate ?? 1),
          ...(vat > 0
            ? {
                Iva: [
                  {
                    // AFIP's `Id`: 5 is 21 %, 4 is 10.5 %, 6 is 27 %. Derived from the rate the
                    // document actually bears rather than assumed.
                    Id: this.vatId(invoice),
                    BaseImp: net,
                    Importe: vat,
                  },
                ],
              }
            : {}),
        },
      ],
    };
  }

  /**
   * The barcode AFIP requires on the printed document.
   *
   * CUIT(11) + tipo(2) + punto de venta(4) + CAE(14) + vencimiento(8) + check digit, where the
   * check is modulus 10 over the rest: odd positions summed, even positions summed and tripled.
   */
  barcode(input: {
    cuit: string;
    documentType: number;
    salesPoint: number;
    cae: string;
    caeExpiry: string;
  }): string {
    const body = [
      input.cuit.replace(/\D/g, '').padStart(11, '0'),
      String(input.documentType).padStart(2, '0'),
      String(input.salesPoint).padStart(4, '0'),
      input.cae.replace(/\D/g, '').padStart(14, '0'),
      input.caeExpiry.replace(/\D/g, '').slice(0, 8),
    ].join('');

    return `${body}${this.modulus10(body)}`;
  }

  /**
   * Modulus 10: odd positions summed, even positions summed and multiplied by three, and the
   * digit that takes the total to the next multiple of ten.
   */
  modulus10(digits: string): string {
    let odd = 0;
    let even = 0;
    for (let index = 0; index < digits.length; index++) {
      // Positions are counted from one, so index 0 is position 1 — odd.
      if ((index + 1) % 2 === 1) odd += Number(digits[index]);
      else even += Number(digits[index]);
    }
    const total = odd * 3 + even;
    return String((10 - (total % 10)) % 10);
  }

  /**
   * `1` factura A, `6` factura B, `11` factura C, and `3`/`8`/`13` for their credit notes.
   *
   * An A invoice goes to a responsable inscripto, a B to a consumidor final or monotributista, and
   * a C is what a monotributista issues. Getting it wrong is not cosmetic: an A invoice lets the
   * buyer take the VAT credit, and issuing one to someone not entitled to it is a fiscal problem
   * for both parties.
   */
  private documentType(input: AfipBuildInput): number {
    const isCredit = input.invoice.type === InvoiceType.CREDIT_NOTE;
    if (input.issuerVatCondition === 'MONOTRIBUTO') return isCredit ? 13 : 11;

    const buyerIsRegistered =
      (input.customer.taxId ?? '').replace(/\D/g, '').length === 11 &&
      (input.customer as unknown as { fiscalProfile?: Record<string, string> }).fiscalProfile?.[
        'condicionIva'
      ] === 'RESPONSABLE_INSCRIPTO';

    if (buyerIsRegistered) return isCredit ? 3 : 1;
    return isCredit ? 8 : 6;
  }

  /** `80` CUIT, `96` DNI, `99` consumidor final sin identificar. */
  private buyerDocumentType(customer: Customer): number {
    const digits = (customer.taxId ?? '').replace(/\D/g, '');
    if (digits.length === 11) return 80;
    if (digits.length >= 7 && digits.length <= 8) return 96;
    return 99;
  }

  /** `1` productos, `2` servicios, `3` ambos. */
  private concept(invoice: Invoice): number {
    const lines = invoice.lineItems ?? [];
    const hasService = lines.some((line) => line.isService);
    const hasGoods = lines.some((line) => !line.isService);
    if (hasService && hasGoods) return 3;
    return hasService ? 2 : 1;
  }

  /** AFIP's VAT rate identifiers. */
  private vatId(invoice: Invoice): number {
    const rate = Math.round(
      ((invoice.lineItems ?? []).find((line) => Number(line.taxAmount ?? 0) > 0)?.taxRate ?? 0.21) *
        1000,
    );
    if (rate === 105) return 4;
    if (rate === 270) return 6;
    if (rate === 50) return 8;
    if (rate === 25) return 9;
    return 5;
  }

  /** AFIP uses its own currency list; `PES` for the peso and `DOL` for the US dollar. */
  private currencyCode(currency: string): string {
    return currency === 'USD' ? 'DOL' : currency;
  }

  private assertIssuable(input: AfipBuildInput): void {
    if ((input.organization.taxId ?? '').replace(/\D/g, '').length !== 11) {
      throw new BadRequestError('EINVOICING.AFIP_EMISOR_SIN_CUIT');
    }
    if (!input.salesPoint || input.salesPoint < 1) {
      throw new BadRequestError('EINVOICING.AFIP_SIN_PUNTO_VENTA');
    }
    if (!input.nextNumber || input.nextNumber < 1) {
      throw new BadRequestError('EINVOICING.AFIP_SIN_NUMERO_COMPROBANTE');
    }
  }

  private yyyymmdd(value: Date | string): string {
    return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10).replace(/-/g, '');
  }
}

/**
 * The WSAA login ticket request, which is the thing that actually gets signed in Argentina.
 *
 * Not part of the builder because it is not about a document: it is the authentication every
 * business call rides on, valid for twelve hours, and requesting a second one inside that window
 * is rejected — so it is cached, and the caching is what makes it work rather than an
 * optimisation.
 */
export function loginTicketRequest(service: string, now: Date = new Date()): string {
  const uniqueId = Math.floor(now.getTime() / 1000);
  // AFIP checks that the generation time is not in the future and the expiry not more than
  // twenty-four hours out. Ten minutes of slack absorbs clock skew between us and them.
  const generation = new Date(now.getTime() - 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expiration = new Date(now.getTime() + 12 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generation}</generationTime>` +
    `<expirationTime>${expiration}</expirationTime>` +
    `</header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  );
}

/**
 * The CMS/PKCS#7 envelope WSAA expects, signed with the taxpayer's certificate.
 *
 * Node has no PKCS#7 signing in `crypto`, and `node-forge` — already a dependency, already used to
 * parse the taxpayer's PKCS#12 — does. The result is base64 DER, which is what the SOAP call
 * carries.
 */
export function signLoginTicket(
  ticketXml: string,
  certificatePem: string,
  privateKeyPem: string,
): string {
  const forge = require('node-forge') as typeof import('node-forge');
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(ticketXml, 'utf8');
  p7.addCertificate(certificatePem);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(privateKeyPem),
    certificate: certificatePem,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}
