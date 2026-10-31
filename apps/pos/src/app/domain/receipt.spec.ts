import type { PosSale, ShiftReport } from '../core/pos-api.service';
import {
  PrintFormat,
  escapeHtml,
  receiptHtml,
  shiftReportHtml,
} from './receipt';

const f: PrintFormat = {
  t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  money: (value) => `RD$${value.toFixed(2)}`,
  dateTime: () => '20/10/2026 10:00',
  lang: 'es',
};

const sale = (over: Partial<PosSale> = {}): PosSale => ({
  id: 'abcdef12-0000-4000-8000-000000000000',
  terminalId: 'CAJA-1',
  shiftId: 's1',
  cashierId: 'u1',
  items: [
    {
      productId: 'p',
      productName: '<b>Café</b>',
      price: 100,
      quantity: 2,
      taxRate: 0.18,
      lineSubtotal: 200,
      lineTax: 36,
    },
  ],
  subtotal: 200,
  tax: 36,
  total: 236,
  paymentMethod: 'cash',
  customerName: 'Ana "La Jefa"',
  payments: [{ method: 'cash', amount: 300 }],
  amountTendered: 300,
  changeDue: 64,
  status: 'PAID',
  createdAt: '2026-10-20T14:00:00Z',
  ...over,
});

const header = {
  context: {
    organization: {
      legalName: 'Colmado & Hijos',
      taxId: '131-12345-6',
      country: 'DO',
    },
    currency: 'DOP',
    standardTaxRate: 0.18,
    taxRequiresConfiguration: false,
  },
  terminalId: 'CAJA-1',
  cashier: 'Dev User',
};

describe('receipt', () => {
  it('escapes every tenant-typed value', () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
    );
    const html = receiptHtml(sale(), header, f);
    expect(html).not.toContain('<b>Café</b>');
    expect(html).toContain('&lt;b&gt;Café&lt;/b&gt;');
    expect(html).toContain('Colmado &amp; Hijos');
    expect(html).toContain('Ana &quot;La Jefa&quot;');
  });

  it('prints totals, tenders, change and the short ticket number', () => {
    const html = receiptHtml(sale(), header, f);
    expect(html).toContain('RD$236.00');
    expect(html).toContain('RD$64.00');
    expect(html).toContain('ABCDEF12');
    expect(html).not.toContain('pos.ticket.voided');
  });

  it('stamps a voided sale with the void and its reason', () => {
    const html = receiptHtml(
      sale({ status: 'CANCELLED', voidReason: 'Cobro duplicado' }),
      header,
      f,
    );
    expect(html).toContain('pos.ticket.voided');
    expect(html).toContain('Cobro duplicado');
  });

  it('the Z report shows counted cash and the variance; the X report does not', () => {
    const report: ShiftReport = {
      shift: {
        id: 's1',
        terminalId: 'CAJA-1',
        userId: 'u1',
        status: 'CLOSED',
        openingBalance: 500,
        salesTotal: 236,
        salesCount: 1,
        expectedBalance: 736,
        closingBalance: 730,
        closingVariance: -6,
        openedAt: '2026-10-20T12:00:00Z',
        closedAt: '2026-10-20T20:00:00Z',
      },
      salesCount: 1,
      subtotal: 200,
      tax: 36,
      total: 236,
      byMethod: { cash: 236, card: 0, transfer: 0, other: 0 },
      itemsSold: 2,
      averageTicket: 236,
      voidedCount: 0,
      voidedTotal: 0,
      expectedCash: 736,
      topProducts: [],
    };
    const z = shiftReportHtml(report, header, f);
    expect(z).toContain('pos.report.z_title');
    expect(z).toContain('RD$-6.00');
    const x = shiftReportHtml(
      {
        ...report,
        shift: {
          ...report.shift,
          status: 'OPEN',
          closingBalance: null,
          closingVariance: null,
        },
      },
      header,
      f,
    );
    expect(x).toContain('pos.report.x_title');
    expect(x).not.toContain('pos.report.variance');
  });

  describe('the comprobante', () => {
    const fiscal = {
      status: {
        saleId: 's',
        fiscal: true,
        invoiceId: 'i',
        invoiceNumber: 'FAC-1',
        fiscalNumber: 'E310000000007',
        fiscalDocumentType: 'E31',
        securityCode: 'A1b2C3',
        qrUrl: 'https://ecf.dgii.gov.do/consultatimbre?x=1',
        status: 'SIGNED',
        signedAt: '2026-10-20T14:00:05Z',
        creditNoteId: null,
        creditNoteFiscalNumber: null,
        customer: { name: 'Ferretería <Uno>', taxId: '101000001' },
      },
      qrDataUri: 'data:image/png;base64,AAAA',
    };

    it('prints the document type, e-NCF, buyer, security code, signature date and QR', () => {
      const html = receiptHtml(sale({ invoiceId: 'i', fiscalNumber: 'E310000000007' }), header, f, fiscal);
      expect(html).toContain('pos.ticket.document_type.e31');
      expect(html).toContain('E310000000007');
      expect(html).toContain('101000001');
      expect(html).toContain('Ferretería &lt;Uno&gt;');
      expect(html).toContain('A1b2C3');
      expect(html).toContain('pos.ticket.signed_at');
      expect(html).toContain('<img class="qr" src="data:image/png;base64,AAAA"');
    });

    it('says the security code is pending when the document is not signed yet', () => {
      const html = receiptHtml(sale({ fiscalNumber: 'E320000000001' }), header, f, {
        status: { ...fiscal.status, fiscalNumber: 'E320000000001', fiscalDocumentType: 'E32', securityCode: null, qrUrl: null, signedAt: null, customer: { name: null, taxId: null } },
        qrDataUri: null,
      });
      expect(html).toContain('pos.ticket.document_type.e32');
      expect(html).toContain('pos.ticket.security_code_pending');
      expect(html).not.toContain('<img');
    });

    it('marks a sale still waiting in the outbox as provisional, with no e-NCF', () => {
      const html = receiptHtml(sale({ status: 'PENDING_SYNC' }), header, f, null);
      expect(html).toContain('pos.ticket.provisional');
      expect(html).not.toContain('pos.ticket.encf');
    });

    it('prints no fiscal block where the company issues no document per sale', () => {
      const html = receiptHtml(sale(), header, f, null);
      expect(html).not.toContain('pos.ticket.encf');
      expect(html).not.toContain('pos.ticket.provisional');
    });
  });
});
