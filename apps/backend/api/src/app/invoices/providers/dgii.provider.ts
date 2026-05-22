import { EInvoiceProvider, EInvoiceResponse } from './einvoice.provider';
import { Invoice } from '../entities/invoice.entity';
import { EInvoiceProviderConfig } from '../localization/entities/einvoice-provider-config.entity';
import * as forge from 'node-forge';
import * as xmlbuilder from 'xmlbuilder';
import { SignedXml } from 'xml-crypto';
import axios from 'axios';

export class DgiiEInvoiceProvider implements EInvoiceProvider {
  constructor(private readonly config: EInvoiceProviderConfig) {}

  async sendInvoice(invoice: Invoice): Promise<EInvoiceResponse> {
    const privateKey: any = '---BEGIN PRIVATE KEY---...';
    const certificate: any = '---BEGIN CERTIFICATE---...';

    const xml = this.buildECFXml(invoice);

    const signedXml = this.signXml(xml, privateKey, certificate);

    try {
      const soapResponse = await axios.post(
        this.config.apiUrl,
        this.buildSoapEnvelope(signedXml),
        { headers: { 'Content-Type': 'text/xml' } },
      );

      const { success, trackId, message } = this.parseDgiiResponse(
        soapResponse.data,
      );
      return { success, providerId: trackId, message };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  getStatus(providerId: string): Promise<string> {
    return Promise.resolve('REJECTED');
  }

  private buildECFXml(invoice: Invoice): string {
    const root = xmlbuilder.create('eCF');
    return root.end({ pretty: true });
  }

  private signXml(xml: string, privateKey: any, cert: any): string {
    const sig: any = new SignedXml();
    sig.signingKey = privateKey;
    sig.addReference({ xpath: "//*[local-name(.)='eCF']" });
    sig.computeSignature(xml);
    return sig.getSignedXml();
  }

  private buildSoapEnvelope(signedXml: string): string {
    return `<soapenv:Envelope ...>${signedXml}</soapenv:Envelope>`;
  }

  private parseDgiiResponse(soapData: string): {
    success: boolean;
    trackId?: string;
    message?: string;
  } {
    return { success: true, trackId: 'TRACKID12345' };
  }
}
