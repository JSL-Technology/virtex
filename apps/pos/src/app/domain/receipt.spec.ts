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
});
