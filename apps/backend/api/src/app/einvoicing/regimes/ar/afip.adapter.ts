import { certificateRegimeFor } from '../../contracts/certificate-policy';
import { Injectable, Logger } from '@nestjs/common';
import { CertificateVaultService, LoadedCertificate } from '../../services/certificate-vault.service';
import { RegimeTransportService } from '../regime-transport.service';
import {
  FiscalRegimeAdapter,
  FiscalRegimeContext,
  FiscalTransmissionResult,
  RegimeNotConfigured,
  SealedFiscalDocument,
} from '../fiscal-regime.types';
import { RegimeAdapterBase } from '../regime-adapter.base';
import { AfipBuilder, loginTicketRequest, signLoginTicket } from './afip.builder';
import { modifiedDocumentOf } from '../modified-document';
import { Invoice } from '../../../invoices/entities/invoice.entity';

/**
 * Argentina — AFIP, WSFEv1.
 *
 * ## Two protocols, not one
 *
 * Every other regime here takes a signed document. AFIP takes a signed *request* — and only after
 * a separate authentication:
 *
 * 1. **WSAA.** A `loginTicketRequest` XML, wrapped in a CMS/PKCS#7 envelope signed with the
 *    taxpayer's certificate, exchanged for a *ticket de acceso* (a token and a signature) that is
 *    valid for twelve hours.
 * 2. **WSFEv1.** `FECAESolicitar`, carrying that ticket, asking AFIP to authorise a specific
 *    invoice number at a specific point of sale.
 *
 * So `seal` here does not sign a document: it produces the WSAA envelope. Nothing about that fits
 * the other six, which is why it is not generalised.
 *
 * ## AFIP owns the numbering, and that is why the invoice arrived without a number
 *
 * `FECAESolicitar` states which number is being requested and refuses anything that is not the
 * next one for that point of sale and document type. The authoritative counter is AFIP's, read
 * with `FECompUltimoAutorizado`. The market's numbering (`AUTHORITY_ON_TRANSMISSION`) therefore
 * records only the type at issuance, and the number is settled here, together with the CAE.
 *
 * A stored counter would be a second source of truth: the first time AFIP rejected a document ours
 * would have advanced and theirs would not, and every later request would be refused for a number
 * gap until somebody reconciled them by hand.
 */
@Injectable()
export class AfipRegimeAdapter extends RegimeAdapterBase implements FiscalRegimeAdapter {
  readonly countryCode = 'AR';
  readonly regime = 'AFIP WSFEv1';

  private readonly logger = new Logger(AfipRegimeAdapter.name);
  private readonly builder = new AfipBuilder();

  constructor(
    vault: CertificateVaultService,
    private readonly transport: RegimeTransportService,
  ) {
    super({ regime: certificateRegimeFor('AR') }, vault);
  }

  async build(context: FiscalRegimeContext): Promise<SealedFiscalDocument> {
    const organization = await this.organizationOf(context);
    const customer = await this.customerOf(context);

    const salesPoint = Number(organization.fiscalProfile?.['puntoVenta'] ?? 0);
    if (!salesPoint) {
      throw new RegimeNotConfigured(this.regime, 'el punto de venta habilitado por AFIP');
    }

    const nextNumber = await this.nextNumber(context.invoice, salesPoint);
    const request = this.builder.build({
      invoice: context.invoice,
      organization,
      customer,
      salesPoint,
      // A note is associated with the comprobante it corrects: its type, its punto de venta and
      // its number, as AFIP authorised them.
      modifies: await modifiedDocumentOf(context.manager, context.invoice, 'AR'),
      // AFIP's own counter decides. Asked for here rather than stored, and asked for inside the
      // same exchange that authorises the document so nothing can slip between the two. The
      // letter (A, B, C) was decided when the document was issued, from both parties' VAT
      // condition, and is read from the document.
      nextNumber,
    });

    return {
      payload: JSON.stringify(request),
      contentType: 'application/json',
      // AFIP assigns the CAE on authorisation. Nothing computed here would be it.
      documentKey: null,
      // The number asked for in this very request. AFIP authorises it together with the CAE, so
      // the outbox records it on acceptance: it is the document's number, printed on it and named
      // by every note that later corrects it.
      assignedNumber: {
        fiscalNumber: afipNumber(salesPoint, nextNumber),
        sequence: nextNumber,
        series: String(salesPoint).padStart(4, '0'),
      },
    };
  }

  /**
   * The WSAA envelope, not a document signature.
   *
   * `signLoginTicket` produces base64 DER CMS with `node-forge`, because Node's `crypto` has no
   * PKCS#7 signing and forge is already a dependency — it is what parses the taxpayer's PKCS#12.
   * The envelope travels beside the request rather than inside it, so the request payload is
   * carried through untouched.
   */
  seal(document: SealedFiscalDocument, certificate: LoadedCertificate): SealedFiscalDocument {
    const ticket = loginTicketRequest('wsfe');
    const cms = signLoginTicket(ticket, certificate.certificatePem, certificate.privateKeyPem);

    return {
      ...document,
      payload: JSON.stringify({
        // Parsed back rather than string-spliced: the request is JSON and concatenating into it
        // would be one escaping mistake away from a malformed body.
        request: JSON.parse(document.payload),
        wsaa: cms,
      }),
    };
  }

  async transmit(
    document: SealedFiscalDocument,
    context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    const result = await this.transport.send('AR', document.payload, {
      organizationId: context.organizationId, purpose: 'submit', contentType: 'application/json',
      trackingKeys: ['CAE', 'cae'],
    });

    if (result.status !== 'ACCEPTED' || !result.trackingId) return result;

    // The CAE and its expiry are what the printed document must carry, along with the barcode
    // computed from both. Kept verbatim: a CAE is checked digit by digit by an inspector.
    return { ...result, authorization: result.trackingId };
  }

  /**
   * Ask AFIP about a document already requested.
   *
   * `FECompConsultar` is what resolves the case that matters: the exchange failed after AFIP may
   * already have authorised, and reissuing would ask for a number AFIP considers used. Consulting
   * is the only way to find out, and it is why the CAE is never assumed lost.
   */
  async checkStatus(
    trackingId: string,
    context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    return this.transport.send(
      'AR',
      JSON.stringify({ operation: 'FECompConsultar', CbteNro: trackingId }),
      { organizationId: context.organizationId, purpose: 'status', contentType: 'application/json', trackingKeys: ['CAE', 'cae'] },
    );
  }

  loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate> {
    return this.certificateFor(context, this.regime, 'su certificado de AFIP');
  }

  /**
   * The next number AFIP expects for this point of sale and document type.
   *
   * Reads `FECompUltimoAutorizado` and adds one. When AFIP cannot be reached the document cannot
   * be numbered at all, and that is the honest outcome: guessing the next number produces a
   * request AFIP refuses, and guessing it twice produces a gap the taxpayer has to explain.
   */
  private async nextNumber(invoice: Invoice, salesPoint: number): Promise<number> {
    const documentType = this.builder.documentType(invoice);

    const result = await this.transport.send(
      'AR',
      JSON.stringify({ operation: 'FECompUltimoAutorizado', PtoVta: salesPoint, CbteTipo: documentType }),
      { organizationId: invoice.organizationId, purpose: 'status', contentType: 'application/json', trackingKeys: ['CbteNro'] },
    );

    if (result.status === 'NOT_CONFIGURED') {
      throw new RegimeNotConfigured(this.regime, 'la transmisión de AFIP en Ajustes › Facturación electrónica');
    }

    const last = Number(result.trackingId ?? NaN);
    if (!Number.isFinite(last)) {
      this.logger.warn(
        `AFIP no devolvió el último comprobante autorizado para el punto de venta ${salesPoint}.`,
      );
      throw new RegimeNotConfigured(this.regime, 'el último número autorizado por AFIP');
    }

    return last + 1;
  }
}

/**
 * `0004-00000123`: how AFIP's punto de venta and number are read, printed and quoted.
 *
 * The parts are what AFIP counts — they are recorded separately beside this — and this is the one
 * string a person compares against the document in their hand.
 */
function afipNumber(salesPoint: number, number: number): string {
  return `${String(salesPoint).padStart(4, '0')}-${String(number).padStart(8, '0')}`;
}
