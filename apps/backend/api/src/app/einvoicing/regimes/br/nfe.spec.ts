import { NfeBuilder, NfeBuildInput } from './nfe.builder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';

/**
 * Brazil — Nota Fiscal Eletrônica 4.00.
 *
 * The chave de acesso and the element the signature must reference are what decide whether SEFAZ
 * accepts the document. The check digit is modulus 11 with weights 2..9, and both remainders below
 * 2 give 0 — which is *not* Ecuador's rule, where a remainder of 1 gives 1. Using one country's
 * rule for the other produces a wrong key roughly one time in six.
 */
describe('NFe 4.00', () => {
  const builder = new NfeBuilder();

  const organization = {
    id: 'org-1',
    legalName: 'INDUSTRIA PAULISTA LTDA',
    taxId: '12.345.678/0001-95',
    address: 'Av. Paulista 1000',
    city: 'São Paulo',
    state: 'SP',
    postalCode: '01310-100',
    fiscalProfile: { inscricaoEstadual: '110042490114', crt: '3' },
  } as unknown as Organization;

  const customer = {
    id: 'cus-1',
    companyName: 'DISTRIBUIDORA CARIOCA LTDA',
    taxId: '98.765.432/0001-10',
    address: 'Rua da Praia 50',
    city: 'Rio de Janeiro',
    stateOrProvince: 'RJ',
    postalCode: '20040-020',
  } as unknown as Customer;

  const invoice = {
    id: 'inv-1',
    invoiceNumber: 'FAC-9',
    // The AUTHORISED number, which is what the authority reads. `invoiceNumber` is this product's
    // own document sequence and carries no fiscal force: the builders used to read it, so a
    // document would have gone out numbered from the internal counter rather than from the range
    // the authority granted.
    ncfNumber: '123',
    customerId: 'cus-1',
    issueDate: '2026-06-10',
    currencyCode: 'BRL',
    subtotal: 1_000,
    taxedTotal: 1_000,
    tax: 180,
    total: 1_180,
    discountTotal: 0,
    type: InvoiceType.INVOICE,
    lineItems: [
      {
        description: 'Peça industrial',
        quantity: 2,
        price: 500,
        lineSubtotal: 1_000,
        taxableBase: 1_000,
        taxRate: 0.18,
        taxAmount: 180,
        fiscalCodes: { ncm: '84129090', cfop: '6102', uCom: 'PC', cProd: 'PI-001' },
      },
    ],
  } as unknown as Invoice;

  const input = (overrides: Partial<NfeBuildInput> = {}): NfeBuildInput => ({
    invoice,
    organization,
    customer,
    stateCode: '35',
    municipalityCode: '3550308',
    environment: '2',
    series: '1',
    numericCode: '12345678',
    ...overrides,
  });

  describe('the chave de acesso', () => {
    it('is forty-four digits in the order SEFAZ fixes', () => {
      const key = builder.accessKey(input());

      expect(key).toHaveLength(44);
      expect(key.slice(0, 2)).toBe('35'); // cUF — São Paulo
      expect(key.slice(2, 6)).toBe('2606'); // AAMM
      expect(key.slice(6, 20)).toBe('12345678000195'); // CNPJ, digits only
      expect(key.slice(20, 22)).toBe('55'); // modelo NF-e
      expect(key.slice(22, 25)).toBe('001'); // série
      expect(key.slice(25, 34)).toBe('000000123'); // nNF
      expect(key.slice(34, 35)).toBe('1'); // tpEmis
      expect(key.slice(35, 43)).toBe('12345678'); // cNF
    });

    it('closes with a modulus-11 check digit over the other forty-three', () => {
      const key = builder.accessKey(input());
      const body = key.slice(0, 43);

      // Recomputed independently: weights 2..9 cycling from the right.
      let total = 0;
      let weight = 2;
      for (let index = body.length - 1; index >= 0; index--) {
        total += Number(body[index]) * weight;
        weight = weight === 9 ? 2 : weight + 1;
      }
      const remainder = total % 11;
      expect(key.slice(43)).toBe(remainder < 2 ? '0' : String(11 - remainder));
    });

    it('gives 0 for both remainders below two, which is not Ecuador’s rule', () => {
      // Ecuador answers 1 for a remainder of 1. Reusing that rule here produces a wrong key about
      // one time in six — frequent enough to be noticed in production, rare enough to pass a small
      // suite.
      expect(builder.modulus11('0')).toBe('0');
      // A single `6` weighted by 2 leaves a remainder of 1.
      expect(builder.modulus11('6')).toBe('0');
    });

    it('changes with the issuing state, because SEFAZ is not federal', () => {
      expect(builder.accessKey(input({ stateCode: '35' }))).not.toBe(
        builder.accessKey(input({ stateCode: '33' })),
      );
    });
  });

  describe('the document', () => {
    it('puts the key on infNFe, which is the element the signature references', () => {
      const { xml, accessKey } = builder.build(input());

      // A signature over the envelope is structurally valid XML-DSig and is rejected on receipt.
      expect(xml).toContain(`<infNFe Id="NFe${accessKey}" versao="4.00">`);
    });

    it('states the operation as interstate when the two states differ', () => {
      // SP to RJ. `idDest` is decided by the two addresses, not chosen by the seller.
      expect(builder.build(input()).xml).toContain('<idDest>2</idDest>');

      const sameState = builder.build(
        input({ customer: { ...customer, stateOrProvince: 'SP' } as unknown as Customer }),
      );
      expect(sameState.xml).toContain('<idDest>1</idDest>');
    });

    it('carries the NCM and the CFOP the product declares', () => {
      const { xml } = builder.build(input());

      expect(xml).toContain('<NCM>84129090</NCM>');
      expect(xml).toContain('<CFOP>6102</CFOP>');
      expect(xml).toContain('<uCom>PC</uCom>');
    });

    it('refuses a line with no NCM rather than inventing a classification', () => {
      // NCM classifies the merchandise and CFOP the operation. Neither can be inferred from a
      // description, and a wrong one misstates the operation to the state.
      const noNcm = {
        ...invoice,
        lineItems: [{ ...invoice.lineItems[0], fiscalCodes: { cfop: '6102' } }],
      } as unknown as Invoice;

      expect(() => builder.build(input({ invoice: noNcm }))).toThrow(
        expect.objectContaining({ messageKey: 'EINVOICING.NFE_LINEA_SIN_CLASIFICACION' }),
      );
    });

    it('identifies the buyer as CNPJ or CPF by the length of the document', () => {
      expect(builder.build(input()).xml).toContain('<CNPJ>98765432000110</CNPJ>');

      const individual = builder.build(
        input({ customer: { ...customer, taxId: '123.456.789-09' } as unknown as Customer }),
      );
      expect(individual.xml).toContain('<CPF>12345678909</CPF>');
      // A natural person is not an ICMS taxpayer.
      expect(individual.xml).toContain('<indIEDest>9</indIEDest>');
    });

    it('states the totals SEFAZ reconciles the lines against', () => {
      const { xml } = builder.build(input());

      expect(xml).toContain('<vProd>1000.00</vProd>');
      expect(xml).toContain('<vICMS>180.00</vICMS>');
      expect(xml).toContain('<vNF>1180.00</vNF>');
    });

    it('issues a return as finality 4', () => {
      const { xml } = builder.build(
        input({ invoice: { ...invoice, type: InvoiceType.CREDIT_NOTE } as Invoice }),
      );

      expect(xml).toContain('<finNFe>4</finNFe>');
      expect(xml).toContain('Devolucao de venda');
    });

    it.each([
      ['el emisor sin CNPJ', { organization: { ...organization, taxId: '123' } as unknown as Organization }, 'EINVOICING.NFE_EMISOR_SIN_CNPJ'],
      ['el receptor sin documento', { customer: { ...customer, taxId: null } as unknown as Customer }, 'EINVOICING.NFE_RECEPTOR_SIN_DOCUMENTO'],
      ['sin códigos IBGE', { municipalityCode: '' }, 'EINVOICING.NFE_SIN_CODIGOS_IBGE'],
    ])('refuses to build with %s', (_name, overrides, messageKey) => {
      expect(() => builder.build(input(overrides as Partial<NfeBuildInput>))).toThrow(
        expect.objectContaining({ messageKey }),
      );
    });
  });
});
