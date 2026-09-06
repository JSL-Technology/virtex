import * as xmlbuilder from 'xmlbuilder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { roundToCurrency } from '../../../common/money';
import { BadRequestError } from '../../../i18n/localized.exception';

/**
 * Brazil — Nota Fiscal Eletrônica 4.00, SEFAZ.
 *
 * ## The chave de acesso
 *
 * Forty-four digits: state code, year and month, issuer CNPJ, model, series, number, emission
 * type, a numeric code, and a check digit over the other forty-three by modulus 11 with weights
 * cycling 2..9 from the right. As in Ecuador the two edge remainders matter — 0 and 1 both give a
 * check digit of 0 here, which is not the same rule as Ecuador's, and using one country's rule for
 * the other produces keys that are wrong roughly one time in six.
 *
 * ## Signed on `infNFe`, not on the envelope
 *
 * The signature's reference must be `#NFe<chave>`, the id of the `infNFe` element. SEFAZ
 * recomputes the digest over that element alone. A signature over the envelope is structurally
 * valid XML-DSig and is rejected on receipt, which is why `XmlSignatureService` takes the
 * reference explicitly rather than defaulting to the whole document.
 *
 * ## The state matters
 *
 * SEFAZ is not federal. Each state runs its own web service and its own authorisation, so the
 * issuer's UF decides both the first two digits of the key and where the document is sent.
 *
 * *Verificar con contabilidad/legal*: `NCM` and `CFOP` classify what is sold and how the operation
 * is treated, and both come from the product and the operation rather than from this code. ICMS
 * has some twenty situation codes (`CST`), and which applies depends on the taxpayer's regime and
 * the destination state — this writes what the tenant configured and refuses to guess.
 */
export interface NfeBuildInput {
  invoice: Invoice;
  organization: Organization;
  customer: Customer;
  /** IBGE code of the issuer's state — `35` São Paulo, `33` Rio de Janeiro. */
  stateCode: string;
  /** IBGE code of the issuing municipality, seven digits. */
  municipalityCode: string;
  /** `1` produção, `2` homologação. */
  environment: '1' | '2';
  /** The série, which the taxpayer runs per establishment. */
  series: string;
  /** Eight digits the issuer chooses, part of the key. */
  numericCode: string;
}

export class NfeBuilder {
  build(input: NfeBuildInput): { xml: string; accessKey: string } {
    this.assertIssuable(input);
    const accessKey = this.accessKey(input);
    return { xml: this.nfe(input, accessKey), accessKey };
  }

  /**
   * `cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)`.
   */
  /**
   * The NF-e model code.
   *
   * `55` is the NF-e proper. `65` is the NFC-e — the consumer note — which is a different document
   * with its own authorisation, its own série and a QR code this builder does not produce, so it is
   * not offered rather than being produced incorrectly.
   *
   * A Brazilian credit note is not a document type at all: it is an NF-e of `finNFe` 4 (devolução)
   * or a separate nota de débito, both still model `55`.
   */
  documentType(): string {
    return '55';
  }

  accessKey(input: NfeBuildInput): string {
    const { invoice, organization } = input;
    const issueDate = this.iso(invoice.issueDate);

    const body = [
      input.stateCode.padStart(2, '0'),
      `${issueDate.slice(2, 4)}${issueDate.slice(5, 7)}`,
      (organization.taxId ?? '').replace(/\D/g, '').padStart(14, '0').slice(0, 14),
      // `55` NF-e. `65` is the consumer NFC-e, which is a different document with its own rules.
      '55',
      input.series.replace(/\D/g, '').padStart(3, '0').slice(0, 3),
      this.documentNumber(invoice.invoiceNumber ?? ''),
      // `1` emissão normal.
      '1',
      input.numericCode.replace(/\D/g, '').padStart(8, '0').slice(0, 8),
    ].join('');

    return `${body}${this.modulus11(body)}`;
  }

  /**
   * Modulus 11, weights 2..9 cycling from the right.
   *
   * Both remainders below 2 give 0 — unlike Ecuador, where a remainder of 1 gives 1. Reusing one
   * country's rule for the other produces a wrong key about one time in six, which is frequent
   * enough to be noticed in production and rare enough to pass a small test suite.
   */
  modulus11(digits: string): string {
    let total = 0;
    let weight = 2;
    for (let index = digits.length - 1; index >= 0; index--) {
      total += Number(digits[index]) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = total % 11;
    return remainder < 2 ? '0' : String(11 - remainder);
  }

  private nfe(input: NfeBuildInput, accessKey: string): string {
    const { invoice, organization, customer } = input;
    const currency = invoice.currencyCode ?? 'BRL';
    const amount = (value: number) => roundToCurrency(value, currency).toFixed(2);

    const root = xmlbuilder.create('NFe', { encoding: 'UTF-8' }).att('xmlns', NFE_NS);
    // The signature references this id. Signing the envelope instead is rejected on receipt.
    const inf = root.ele('infNFe').att('Id', `NFe${accessKey}`).att('versao', '4.00');

    const ide = inf.ele('ide');
    ide.ele('cUF', {}, input.stateCode.padStart(2, '0'));
    ide.ele('cNF', {}, accessKey.slice(35, 43));
    ide.ele('natOp', {}, invoice.type === InvoiceType.CREDIT_NOTE ? 'Devolucao de venda' : 'Venda de mercadoria');
    ide.ele('mod', {}, '55');
    ide.ele('serie', {}, String(Number(input.series.replace(/\D/g, '') || 1)));
    ide.ele('nNF', {}, String(Number(this.documentNumber(invoice.invoiceNumber ?? ''))));
    ide.ele('dhEmi', {}, this.timestamp(invoice.issueDate));
    // `1` saída — a sale leaves the establishment.
    ide.ele('tpNF', {}, '1');
    // `1` operação interna, `2` interestadual. Decided by the two states, not by the seller.
    ide.ele('idDest', {}, this.destination(input));
    ide.ele('cMunFG', {}, input.municipalityCode);
    ide.ele('tpImp', {}, '1');
    ide.ele('tpEmis', {}, '1');
    ide.ele('cDV', {}, accessKey.slice(-1));
    ide.ele('tpAmb', {}, input.environment);
    ide.ele('finNFe', {}, invoice.type === InvoiceType.CREDIT_NOTE ? '4' : '1');
    ide.ele('indFinal', {}, '1');
    ide.ele('indPres', {}, '1');
    ide.ele('procEmi', {}, '0');
    ide.ele('verProc', {}, 'virtex-1.0');

    const emit = inf.ele('emit');
    emit.ele('CNPJ', {}, (organization.taxId ?? '').replace(/\D/g, ''));
    emit.ele('xNome', {}, organization.legalName);
    const emitAddress = emit.ele('enderEmit');
    emitAddress.ele('xLgr', {}, organization.address ?? '');
    emitAddress.ele('xBairro', {}, organization.city ?? '');
    emitAddress.ele('cMun', {}, input.municipalityCode);
    emitAddress.ele('xMun', {}, organization.city ?? '');
    emitAddress.ele('UF', {}, organization.state ?? '');
    emitAddress.ele('CEP', {}, (organization.postalCode ?? '').replace(/\D/g, ''));
    // Inscrição estadual: the state registration, which a taxpayer selling goods must hold.
    emit.ele('IE', {}, organization.fiscalProfile?.['inscricaoEstadual'] ?? '');
    // `1` simples nacional, `3` regime normal.
    emit.ele('CRT', {}, organization.fiscalProfile?.['crt'] ?? '3');

    const dest = inf.ele('dest');
    const buyerDocument = (customer.taxId ?? '').replace(/\D/g, '');
    dest.ele(buyerDocument.length === 14 ? 'CNPJ' : 'CPF', {}, buyerDocument);
    dest.ele('xNome', {}, customer.companyName);
    const destAddress = dest.ele('enderDest');
    destAddress.ele('xLgr', {}, customer.address ?? '');
    destAddress.ele('xMun', {}, customer.city ?? '');
    destAddress.ele('UF', {}, customer.stateOrProvince ?? '');
    destAddress.ele('CEP', {}, (customer.postalCode ?? '').replace(/\D/g, ''));
    // `1` contribuinte de ICMS, `9` não contribuinte.
    dest.ele('indIEDest', {}, buyerDocument.length === 14 ? '1' : '9');

    for (const [index, line] of (invoice.lineItems ?? []).entries()) {
      const det = inf.ele('det').att('nItem', String(index + 1));
      const prod = det.ele('prod');
      prod.ele('cProd', {}, line.fiscalCodes?.['cProd'] ?? String(index + 1));
      prod.ele('xProd', {}, line.description ?? '');
      // NCM classifies the merchandise and CFOP the operation. Both come from the product and the
      // operation; neither can be inferred from a description.
      prod.ele('NCM', {}, this.required(line, 'ncm'));
      prod.ele('CFOP', {}, this.required(line, 'cfop'));
      prod.ele('uCom', {}, line.fiscalCodes?.['uCom'] ?? 'UN');
      prod.ele('qCom', {}, Number(line.quantity).toFixed(4));
      prod.ele('vUnCom', {}, Number(line.price ?? 0).toFixed(10));
      prod.ele('vProd', {}, amount(line.lineSubtotal ?? 0));
      prod.ele('indTot', {}, '1');

      const imposto = det.ele('imposto');
      const icms = imposto.ele('ICMS').ele('ICMS00');
      icms.ele('orig', {}, line.fiscalCodes?.['origem'] ?? '0');
      icms.ele('CST', {}, line.fiscalCodes?.['cstIcms'] ?? '00');
      icms.ele('modBC', {}, '3');
      icms.ele('vBC', {}, amount(line.taxableBase ?? line.lineSubtotal ?? 0));
      icms.ele('pICMS', {}, (Number(line.taxRate ?? 0) * 100).toFixed(2));
      icms.ele('vICMS', {}, amount(line.taxAmount ?? 0));
    }

    const total = inf.ele('total').ele('ICMSTot');
    total.ele('vBC', {}, amount(invoice.taxedTotal ?? invoice.subtotal));
    total.ele('vICMS', {}, amount(invoice.tax ?? 0));
    total.ele('vProd', {}, amount(invoice.subtotal));
    total.ele('vDesc', {}, amount(invoice.discountTotal ?? 0));
    total.ele('vNF', {}, amount(invoice.total));

    // `9` sem frete: this product does not model freight, and declaring a modality it cannot
    // substantiate would misstate the operation.
    inf.ele('transp').ele('modFrete', {}, '9');

    return root.end({ pretty: false });
  }

  /** `1` interna, `2` interestadual, `3` exterior. Decided by the two states. */
  private destination(input: NfeBuildInput): string {
    const from = (input.organization.state ?? '').toUpperCase();
    const to = (input.customer.stateOrProvince ?? '').toUpperCase();
    if (!to || from === to) return '1';
    return '2';
  }

  private documentNumber(invoiceNumber: string): string {
    const digits = invoiceNumber.replace(/\D/g, '');
    return (digits || '1').padStart(9, '0').slice(-9);
  }

  private required(
    line: { fiscalCodes?: Record<string, string> | null; description?: string },
    key: string,
  ): string {
    const value = line.fiscalCodes?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new BadRequestError('EINVOICING.NFE_LINEA_SIN_CLASIFICACION', {
      key: key.toUpperCase(),
      line: line.description ?? '',
    });
  }

  private assertIssuable(input: NfeBuildInput): void {
    if ((input.organization.taxId ?? '').replace(/\D/g, '').length !== 14) {
      throw new BadRequestError('EINVOICING.NFE_EMISOR_SIN_CNPJ');
    }
    if (!(input.customer.taxId ?? '').replace(/\D/g, '')) {
      throw new BadRequestError('EINVOICING.NFE_RECEPTOR_SIN_DOCUMENTO', {
        customer: input.customer.companyName,
      });
    }
    if (!input.stateCode?.trim() || !input.municipalityCode?.trim()) {
      throw new BadRequestError('EINVOICING.NFE_SIN_CODIGOS_IBGE');
    }
  }

  private iso(value: Date | string): string {
    return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
  }

  /** `AAAA-MM-DDThh:mm:ss-03:00` — SEFAZ requires the offset. */
  private timestamp(value: Date | string): string {
    const iso = typeof value === 'string' ? value : value.toISOString();
    const time = iso.length > 10 ? iso.slice(11, 19) : '12:00:00';
    return `${iso.slice(0, 10)}T${time}-03:00`;
  }
}

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
