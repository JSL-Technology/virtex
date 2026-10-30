import type {
  PosContext,
  PosSale,
  ShiftReport,
  TenderMethod,
} from '../core/pos-api.service';

/** What the documents need to put words and amounts on paper, in the tenant's language and locale. */
export interface PrintFormat {
  t(key: string, params?: Record<string, unknown>): string;
  money(value: number): string;
  dateTime(value: string | Date): string;
  lang: string;
}

export interface ReceiptHeader {
  context: PosContext | null;
  terminalId: string;
  cashier: string;
  branch?: string | null;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] as string,
  );
}

/**
 * Thermal-printer layout: 72 mm of paper (an 80 mm roll's printable width), one column, monospace
 * figures. Every value is escaped — product names and customer names are tenant-typed text.
 */
const STYLE = `
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.35 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; width: 72mm; margin: 0 auto; color: #000; }
  h1 { font-size: 14px; margin: 0; text-align: center; text-transform: uppercase; }
  .c { text-align: center; } .r { text-align: right; } .muted { color: #333; }
  p { margin: 2px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .big td { font-size: 14px; font-weight: 700; padding-top: 3px; }
  .void { border: 2px solid #000; text-align: center; font-weight: 700; padding: 4px; margin: 6px 0; letter-spacing: 2px; }
`;

function headerHtml(header: ReceiptHeader, f: PrintFormat): string {
  const org = header.context?.organization;
  return [
    `<h1>${escapeHtml(org?.legalName || f.t('apps.pos'))}</h1>`,
    org?.taxId
      ? `<p class="c">${escapeHtml(f.t('pos.ticket.tax_id', { taxId: org.taxId }))}</p>`
      : '',
    header.branch ? `<p class="c">${escapeHtml(header.branch)}</p>` : '',
  ].join('');
}

function document(title: string, lang: string, body: string): string {
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

/** A sale's ticket. A voided sale prints with the void stamped across it and its reason. */
export function receiptHtml(
  sale: PosSale,
  header: ReceiptHeader,
  f: PrintFormat,
): string {
  const rows = (sale.items ?? [])
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.productName)}<br><span class="muted">${escapeHtml(line.quantity)} × ${escapeHtml(f.money(line.price))}</span></td>` +
        `<td class="r">${escapeHtml(f.money(line.lineSubtotal ?? line.price * line.quantity))}</td></tr>`,
    )
    .join('');
  const tenders = (sale.payments ?? [])
    .map(
      (payment) =>
        `<tr><td>${escapeHtml(f.t('pos.pay.method.' + payment.method))}${payment.reference ? ` <span class="muted">#${escapeHtml(payment.reference)}</span>` : ''}</td>` +
        `<td class="r">${escapeHtml(f.money(payment.amount))}</td></tr>`,
    )
    .join('');
  const body = [
    headerHtml(header, f),
    `<hr>`,
    // The comprobante fiscal is what makes the ticket a tax document (QA R3-C02); without one the
    // ticket says so instead of passing for a receipt the customer can claim.
    sale.fiscalNumber
      ? `<p><strong>${escapeHtml(f.t('pos.ticket.fiscal_number', { number: sale.fiscalNumber }))}</strong></p>`
      : header.context?.organization?.country === 'DO'
        ? `<p class="muted">${escapeHtml(f.t('pos.ticket.not_fiscal'))}</p>`
        : '',
    `<p>${escapeHtml(f.t('pos.ticket.number', { number: sale.id.slice(0, 8).toUpperCase() }))}</p>`,
    `<p>${escapeHtml(f.dateTime(sale.createdAt))}</p>`,
    `<p>${escapeHtml(f.t('pos.ticket.terminal_cashier', { terminal: header.terminalId, cashier: header.cashier }))}</p>`,
    `<p>${escapeHtml(f.t('pos.customer'))}: ${escapeHtml(sale.customerName || f.t('pos.walk_in_customer'))}</p>`,
    sale.status === 'CANCELLED'
      ? `<div class="void">${escapeHtml(f.t('pos.ticket.voided'))}</div>${sale.voidReason ? `<p>${escapeHtml(sale.voidReason)}</p>` : ''}`
      : '',
    `<hr><table>${rows}</table><hr>`,
    `<table>`,
    `<tr><td>${escapeHtml(f.t('pos.subtotal'))}</td><td class="r">${escapeHtml(f.money(sale.subtotal))}</td></tr>`,
    `<tr><td>${escapeHtml(f.t('pos.taxes'))}</td><td class="r">${escapeHtml(f.money(sale.tax))}</td></tr>`,
    `<tr class="big"><td>${escapeHtml(f.t('pos.total'))}</td><td class="r">${escapeHtml(f.money(sale.total))}</td></tr>`,
    `</table><hr><table>${tenders}`,
    Number(sale.changeDue) > 0
      ? `<tr><td>${escapeHtml(f.t('pos.pay.change'))}</td><td class="r">${escapeHtml(f.money(sale.changeDue))}</td></tr>`
      : '',
    `</table><hr>`,
    `<p class="c">${escapeHtml(f.t('pos.ticket.thanks'))}</p>`,
  ].join('');
  return document(f.t('pos.ticket.title'), f.lang, body);
}

const METHODS: TenderMethod[] = ['cash', 'card', 'transfer', 'other'];

/** The X report (open shift) or Z report (closed shift), for the drawer's paper trail. */
export function shiftReportHtml(
  report: ShiftReport,
  header: ReceiptHeader,
  f: PrintFormat,
): string {
  const shift = report.shift;
  const closed = shift.status === 'CLOSED';
  const row = (label: string, value: string) =>
    `<tr><td>${escapeHtml(label)}</td><td class="r">${escapeHtml(value)}</td></tr>`;
  const body = [
    headerHtml(header, f),
    `<hr><h1>${escapeHtml(f.t(closed ? 'pos.report.z_title' : 'pos.report.x_title'))}</h1>`,
    `<p class="c">${escapeHtml(f.t('pos.ticket.terminal_cashier', { terminal: header.terminalId, cashier: header.cashier }))}</p>`,
    `<p class="c">${escapeHtml(f.t('pos.report.opened_at', { when: f.dateTime(shift.openedAt) }))}</p>`,
    closed && shift.closedAt
      ? `<p class="c">${escapeHtml(f.t('pos.report.closed_at', { when: f.dateTime(shift.closedAt) }))}</p>`
      : '',
    `<p class="c">${escapeHtml(f.t('pos.report.printed_at', { when: f.dateTime(new Date()) }))}</p>`,
    `<hr><table>`,
    row(f.t('pos.report.sales_count'), String(report.salesCount)),
    row(f.t('pos.report.items_sold'), String(report.itemsSold)),
    row(f.t('pos.subtotal'), f.money(report.subtotal)),
    row(f.t('pos.taxes'), f.money(report.tax)),
    `<tr class="big"><td>${escapeHtml(f.t('pos.total'))}</td><td class="r">${escapeHtml(f.money(report.total))}</td></tr>`,
    row(f.t('pos.report.average_ticket'), f.money(report.averageTicket)),
    `</table><hr><table>`,
    ...METHODS.map((method) =>
      row(
        f.t('pos.pay.method.' + method),
        f.money(report.byMethod[method] ?? 0),
      ),
    ),
    `</table><hr><table>`,
    row(
      f.t('pos.report.voided', { count: report.voidedCount }),
      f.money(report.voidedTotal),
    ),
    row(f.t('pos.report.opening_float'), f.money(shift.openingBalance)),
    row(
      f.t('pos.report.expected_cash'),
      f.money(
        closed && shift.expectedBalance != null
          ? shift.expectedBalance
          : report.expectedCash,
      ),
    ),
    closed && shift.closingBalance != null
      ? row(f.t('pos.counted_cash'), f.money(shift.closingBalance))
      : '',
    closed && shift.closingVariance != null
      ? `<tr class="big"><td>${escapeHtml(f.t('pos.report.variance'))}</td><td class="r">${escapeHtml(f.money(shift.closingVariance))}</td></tr>`
      : '',
    `</table>`,
    report.topProducts.length
      ? `<hr><p><strong>${escapeHtml(f.t('pos.report.top_products'))}</strong></p><table>${report.topProducts
          .map((p) => row(`${p.quantity} × ${p.productName}`, f.money(p.total)))
          .join('')}</table>`
      : '',
    `<hr><p class="c">${escapeHtml(f.t('pos.report.signature'))}</p><p>&nbsp;</p><p class="c">______________________</p>`,
  ].join('');
  return document(
    f.t(closed ? 'pos.report.z_title' : 'pos.report.x_title'),
    f.lang,
    body,
  );
}
