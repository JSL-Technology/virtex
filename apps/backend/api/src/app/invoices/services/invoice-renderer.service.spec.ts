// The HTML path never launches Chromium, and puppeteer ships as ESM that Jest cannot require.
jest.mock('puppeteer', () => ({ launch: jest.fn() }));

import * as fs from 'fs';
import * as path from 'path';
import { I18nService } from '../../i18n/i18n.service';
import { Invoice } from '../entities/invoice.entity';
import {
  INVOICE_DOCUMENT_TEMPLATE,
  InvoiceRenderContext,
  InvoiceRendererService,
  documentTemplateCandidates,
  resolveDocumentTemplate,
} from './invoice-renderer.service';

/**
 * The printed invoice is the document the customer receives — as a PDF download, as the print
 * view and as the e-mail attachment. It once rendered the e-mail body instead, with
 * `{{number}}` and `{{total}}` unresolved, because the bundle copied the e-mail's `invoice.hbs`
 * over the printed one. These tests pin the template it reads and what the output must contain.
 */
describe('InvoiceRendererService', () => {
  const organization = {
    id: 'org-1',
    legalName: 'Ferretería Demo SRL',
    taxId: '131234569',
    country: 'DO',
    address: 'Av. 27 de Febrero #345',
    city: 'Santo Domingo',
  } as unknown as InvoiceRenderContext['organization'];

  const invoice = {
    id: 'inv-1',
    invoiceNumber: 'FAC-00000001',
    fiscalNumber: 'E310000000001',
    fiscalDocumentType: 'E31',
    currencyCode: 'DOP',
    issueDate: '2026-10-10',
    dueDate: '2026-11-09',
    subtotal: 6000,
    discountTotal: 0,
    taxedTotal: 6000,
    exemptTotal: 0,
    tax: 1080,
    serviceCharge: 0,
    taxWithheld: 0,
    incomeTaxWithheld: 0,
    total: 7080,
    netReceivable: 7080,
    customerName: 'Constructora Los Pinos SRL',
    customerTaxId: '101123451',
    customerAddress: 'Calle El Sol #12',
    customer: {
      companyName: 'Constructora Los Pinos SRL',
      taxId: '101123451',
      country: 'DO',
      address: 'Calle El Sol #12',
    },
    lineItems: [
      { sortOrder: 0, description: 'Cemento Gris Portland 42.5 kg', quantity: 10, price: 450, taxAmount: 810, total: 5310 },
      { sortOrder: 1, description: 'Servicio de entrega a domicilio', quantity: 1, price: 1500, taxAmount: 270, total: 1770 },
    ],
  } as unknown as Invoice;

  it('resolves the printed-document template, never the e-mail template', () => {
    const resolved = resolveDocumentTemplate(INVOICE_DOCUMENT_TEMPLATE);
    expect(fs.existsSync(resolved)).toBe(true);
    expect(path.basename(resolved)).toBe('invoice-document.hbs');
    expect(resolved).not.toContain(`${path.sep}mail${path.sep}`);
    for (const candidate of documentTemplateCandidates(INVOICE_DOCUMENT_TEMPLATE)) {
      expect(candidate).not.toContain(`${path.sep}mail${path.sep}`);
    }
  });

  it('renders the invoice itself: issuer, buyer, fiscal number, lines and total', async () => {
    const renderer = new InvoiceRendererService(new I18nService());
    const html = await renderer.renderHtml({ invoice, organization, language: 'es', locale: 'es-DO' });

    expect(html).toContain('Ferretería Demo SRL');
    expect(html).toContain('Constructora Los Pinos SRL');
    expect(html).toContain('101123451');
    expect(html).toContain('131234569');
    expect(html).toContain('E310000000001');
    expect(html).toContain('Cemento Gris Portland 42.5 kg');
    expect(html).toContain('7,080.00');
    // Nothing left unresolved: the e-mail template's `{{number}}` was the symptom.
    expect(html).not.toMatch(/\{\{[^}]*\}\}/);
  });

  it('states the e-mail total and due date in the language and format of the document (QA M4)', () => {
    const renderer = new InvoiceRendererService({} as never);
    // A Dominican customer with no stated language: Spanish, Dominican figures — not «DOP 7080.00»
    // and «2026-11-09» in the sender's English.
    const dominican = renderer.emailSummary({ invoice, organization });
    expect(dominican.language).toBe('es');
    expect(dominican.total.replace(/\s/g, ' ')).toBe('DOP 7,080.00');
    expect(dominican.dueDate).toBe('9 de noviembre de 2026');

    // A customer who asked for English reads English words, still in the issuer's figures.
    const english = renderer.emailSummary({
      invoice: { ...invoice, customer: { ...invoice.customer, preferredLanguage: 'en' } } as Invoice,
      organization,
    });
    expect(english.language).toBe('en');
    expect(english.dueDate).toMatch(/November 9, 2026|9 November 2026/);
  });
});
