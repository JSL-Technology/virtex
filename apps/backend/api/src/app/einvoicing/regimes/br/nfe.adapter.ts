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
import { NfeBuilder } from './nfe.builder';

/**
 * Brazil — NF-e 4.00, SEFAZ.
 *
 * ## The signature references `infNFe`, not the envelope
 *
 * The `Id` attribute of `infNFe` is `NFe` followed by the 44-digit chave de acesso, and the
 * signature's reference URI is `#` plus exactly that. A signature over the whole `NFe` element
 * validates as XML and is rejected by the SEFAZ with rejection 297 (*assinatura difere do
 * calculado*) — which says nothing about what is actually wrong. It is the single most common way
 * a Brazilian integration fails, so the reference is derived from the document rather than
 * assumed.
 *
 * ## The SEFAZ is a state authority, not a federal one
 *
 * Each state runs its own web service, and several delegate to another state's. So there is no
 * national endpoint to hardcode even if hardcoding were acceptable: the endpoint is configuration,
 * and a tenant whose state is not configured gets `NOT_CONFIGURED` rather than a document sent to
 * the wrong state and refused.
 *
 * *Verificar con contabilidad/legal*: `NCM`, `CFOP` and the ICMS situation code (`CST`) classify
 * what is sold and how the operation is taxed. They come from the product and the operation, and
 * the builder writes what the tenant configured rather than guessing.
 */
@Injectable()
export class NfeRegimeAdapter extends RegimeAdapterBase implements FiscalRegimeAdapter {
  readonly countryCode = 'BR';
  readonly regime = 'NF-e 4.00';

  private readonly builder = new NfeBuilder();

  constructor(
    vault: CertificateVaultService,
    private readonly signatures: XmlSignatureService,
    private readonly transport: RegimeTransportService,
    private readonly ranges: FiscalRangeService,
  ) {
    super({ regime: 'NFE' }, vault);
  }

  async build(context: FiscalRegimeContext): Promise<SealedFiscalDocument> {
    const organization = await this.organizationOf(context);
    const customer = await this.customerOf(context);
    const settings = await this.settingsOf(context.manager, context.organizationId, 'BR');

    if (!settings?.stateCode || !settings.municipalityCode) {
      throw new RegimeNotConfigured(
        this.regime,
        'os códigos IBGE do estado e do município do emitente',
      );
    }
    if (!settings.numericCode) {
      throw new RegimeNotConfigured(this.regime, 'o código numérico de oito dígitos');
    }

    const range = await this.seriesOf(context);

    const { xml, accessKey } = this.builder.build({
      invoice: context.invoice,
      organization,
      customer,
      stateCode: settings.stateCode,
      municipalityCode: settings.municipalityCode,
      // `1` produção, `2` homologação — and it is part of the chave de acesso, so building for the
      // wrong one produces a different 44-digit key.
      environment: this.environmentCode(settings, { production: '1', certification: '2' }) as
        | '1'
        | '2',
      series: range,
      numericCode: settings.numericCode,
    });

    return { payload: xml, contentType: 'application/xml', documentKey: accessKey };
  }

  /** The série the document's number was drawn from. */
  private async seriesOf(context: FiscalRegimeContext): Promise<string> {
    const range = await this.ranges.rangeContaining(context.manager, {
      organizationId: context.organizationId,
      countryCode: 'BR',
      documentType: this.builder.documentType(),
      number: this.assignedNumber(context, this.regime),
    });
    return range.series;
  }

  /**
   * XMLDSig referencing `infNFe` by its `Id`, appended to the `NFe` element.
   *
   * The reference is read out of the document rather than recomputed, so the signed element and
   * the reference cannot disagree.
   */
  seal(document: SealedFiscalDocument, certificate: LoadedCertificate): SealedFiscalDocument {
    const infId = /<infNFe[^>]*\sId="([^"]+)"/.exec(document.payload)?.[1];
    if (!infId) {
      throw new RegimeNotConfigured(this.regime, 'o atributo Id de infNFe');
    }

    return {
      ...document,
      payload: this.signatures.sign(document.payload, certificate, {
        appendTo: 'NFe',
        referenceUri: `#${infId}`,
      }),
    };
  }

  async transmit(
    document: SealedFiscalDocument,
    _context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    const result = await this.transport.send('BR', document.payload, {
      contentType: 'application/soap+xml',
      // `nProt` is the protocol number, which is the authorisation; `nRec` is the receipt of an
      // asynchronous batch, which still has to be looked up.
      trackingKeys: ['nProt', 'nRec'],
    });

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
    return this.transport.send('BR', `<consSitNFe><chNFe>${trackingId}</chNFe></consSitNFe>`, {
      contentType: 'application/soap+xml',
      trackingKeys: ['nProt'],
    });
  }

  loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate> {
    return this.certificateFor(context, this.regime, 'seu certificado A1 ou A3');
  }
}
