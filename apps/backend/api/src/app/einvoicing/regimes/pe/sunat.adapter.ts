import { Injectable } from '@nestjs/common';
import { CertificateVaultService, LoadedCertificate } from '../../services/certificate-vault.service';
import { XmlSignatureService } from '../xml-signature.service';
import { RegimeTransportService } from '../regime-transport.service';
import { FiscalRangeService } from '../../services/fiscal-range.service';
import {
  FiscalRegimeAdapter,
  FiscalRegimeContext,
  FiscalTransmissionResult,
  RegimeNotConfigured,
  SealedFiscalDocument,
} from '../fiscal-regime.types';
import { RegimeAdapterBase } from '../regime-adapter.base';
import { SunatBuilder } from './sunat.builder';

/**
 * Peru — comprobante de pago electrónico, SUNAT, UBL 2.1.
 *
 * ## The CDR is the receipt, and it has to be kept
 *
 * SUNAT answers a submission with a *Constancia de Recepción*: a signed XML, inside a ZIP, which
 * is what proves the document was accepted. The submission is not proof of anything — a taxpayer
 * asked during an audit to show that a sale was declared produces the CDR, and one who only kept
 * the invoice cannot. So the CDR is returned as the transmission's `authorization` and stored with
 * the submission, rather than being read for a status code and discarded.
 *
 * ## The document names itself
 *
 * `RUC-TipoDocumento-Serie-Correlativo` — `20123456789-01-F001-00000123` — is the file name, the
 * name of the ZIP that carries it, and the identifier in every later exchange. Getting it wrong is
 * a rejection before SUNAT reads the document at all.
 */
@Injectable()
export class SunatRegimeAdapter extends RegimeAdapterBase implements FiscalRegimeAdapter {
  readonly countryCode = 'PE';
  readonly regime = 'SUNAT UBL 2.1';

  private readonly builder = new SunatBuilder();

  constructor(
    vault: CertificateVaultService,
    private readonly signatures: XmlSignatureService,
    private readonly transport: RegimeTransportService,
    private readonly ranges: FiscalRangeService,
  ) {
    super({ regime: 'SUNAT' }, vault);
  }

  async build(context: FiscalRegimeContext): Promise<SealedFiscalDocument> {
    const organization = await this.organizationOf(context);
    const customer = await this.customerOf(context);

    // The series is the range's, not the tenant's: a taxpayer runs F001 and B001 at once, and the
    // series a document belongs to is the one its number was drawn from.
    const documentType = context.invoice.fiscalDocumentType;
    if (!documentType) {
      throw new RegimeNotConfigured(this.regime, 'el tipo de comprobante del documento');
    }
    const range = await this.ranges.rangeContaining(context.manager, {
      organizationId: context.organizationId,
      countryCode: 'PE',
      documentType,
      number: this.assignedNumber(context, this.regime),
    });

    const { xml, documentName } = this.builder.build({
      invoice: context.invoice,
      organization,
      customer,
      series: range.series,
    });

    return { payload: xml, contentType: 'application/xml', documentKey: documentName };
  }

  /**
   * XAdES-BES inside `ext:ExtensionContent`, which SUNAT requires the document to carry empty
   * until it is filled.
   *
   * The reference is the whole document with the enveloped transform: SUNAT recomputes the digest
   * over the invoice as transmitted, and a signature over the extension alone is a rejection with
   * a message about the digest value.
   */
  seal(document: SealedFiscalDocument, certificate: LoadedCertificate): SealedFiscalDocument {
    return {
      ...document,
      payload: this.signatures.sign(document.payload, certificate, {
        appendTo: 'ExtensionContent',
        referenceUri: '',
      }),
    };
  }

  async transmit(
    document: SealedFiscalDocument,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    const result = await this.transport.send('PE', document.payload, {
      contentType: 'application/xml',
      // `applicationResponse` is the CDR itself; the ticket is what an asynchronous submission
      // returns and is looked up later with `getStatus`.
      trackingKeys: ['applicationResponse', 'ticket'],
    });

    // The CDR, verbatim, is the constancia. Never summarised into a status: the signed XML is the
    // evidence, and a paraphrase of it proves nothing to SUNAT.
    return {
      ...result,
      authorization: result.trackingId ?? null,
      trackingId: result.trackingId ?? document.documentKey,
    };
  }

  async checkStatus(
    trackingId: string,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    return this.transport.send('PE', `<getStatus><ticket>${trackingId}</ticket></getStatus>`, {
      contentType: 'application/xml',
      trackingKeys: ['applicationResponse', 'statusCode'],
    });
  }

  loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate> {
    return this.certificateFor(context, this.regime, 'su certificado digital y sus claves SOL');
  }
}
