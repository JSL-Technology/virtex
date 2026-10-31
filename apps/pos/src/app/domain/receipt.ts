import type {
  PosContext,
  PosFiscalStatus,
  PosSale,
  ShiftReport,
  TenderMethod,
} from '../core/pos-api.service';

/** The sale's comprobante as the ticket prints it, and its QR already rendered as an image. */
export interface ReceiptFiscal {
  status: PosFiscalStatus | null;
  qrDataUri: string | null;
}

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
  .doc { text-align: center; font-weight: 700; margin: 4px 0; }
  .qr { display: block; margin: 6px auto; width: 34mm; height: 34mm; }
`;

function headerHtml(header: ReceiptHeader, f: PrintFormat): string {
  const org = header.context?.organization;
  const address = [org?.address, org?.city].filter(Boolean).join(', ');
  return [
    `<h1>${escapeHtml(org?.legalName || f.t('apps.pos'))}</h1>`,
    org?.taxId
      ? `<p class="c">${escapeHtml(f.t('pos.ticket.tax_id', { taxId: org.taxId }))}</p>`
      : '',
    address ? `<p class="c">${escapeHtml(address)}</p>` : '',
    header.branch ? `<p class="c">${escapeHtml(header.branch)}</p>` : '',
  ].join('');
}

/**
 * The comprobante's own block: which document it is, its e-NCF and, for a crédito fiscal, the
 * buyer. A sale still in the outbox says so instead — it has no e-NCF until the server issues it.
 */
function fiscalHeadHtml(sale: PosSale, fiscal: ReceiptFiscal | null, f: PrintFormat): string {
  if (sale.status === 'PENDING_SYNC') {
    return `<div class="void">${escapeHtml(f.t('pos.ticket.provisional'))}</div><p class="c">${escapeHtml(f.t('pos.ticket.provisional_note'))}</p>`;
  }
  const status = fiscal?.status;
  const ncf = status?.fiscalNumber ?? sale.fiscalNumber;
  if (!ncf) return '';
  const type = (status?.fiscalDocumentType ?? sale.fiscalDocumentType ?? ncf.slice(0, 3)).toUpperCase();
  const taxId = status?.customer.taxId ?? sale.customerTaxId;
  return [
    `<p class="doc">${escapeHtml(f.t('pos.ticket.document_type.' + type.toLowerCase()))}</p>`,
    `<p class="c">${escapeHtml(f.t('pos.ticket.encf', { ncf }))}</p>`,
    taxId
      ? `<p>${escapeHtml(f.t('pos.ticket.buyer_tax_id', { taxId }))}</p><p>${escapeHtml(f.t('pos.ticket.buyer_name', { name: status?.customer.name ?? sale.customerName ?? '' }))}</p>`
      : '',
  ].join('');
}

/** The security code, the signature's date and the timbre QR that let anyone check the document. */
function fiscalFootHtml(sale: PosSale, fiscal: ReceiptFiscal | null, f: PrintFormat): string {
  const status = fiscal?.status;
  if (sale.status === 'PENDING_SYNC' || !(status?.fiscalNumber ?? sale.fiscalNumber)) return '';
  return [
    status?.securityCode
      ? `<p>${escapeHtml(f.t('pos.ticket.security_code', { code: status.securityCode }))}</p>`
      : `<p>${escapeHtml(f.t('pos.ticket.security_code_pending'))}</p>`,
    status?.signedAt
      ? `<p>${escapeHtml(f.t('pos.ticket.signed_at', { when: f.dateTime(status.signedAt) }))}</p>`
      : '',
    fiscal?.qrDataUri ? `<img class="qr" src="${escapeHtml(fiscal.qrDataUri)}" alt="">` : '',
    status?.creditNoteFiscalNumber
      ? `<p class="c">${escapeHtml(f.t('pos.ticket.cancelled_by', { ncf: status.creditNoteFiscalNumber }))}</p>`
      : '',
    `<hr>`,
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
  fiscal: ReceiptFiscal | null = null,
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
    fiscalHeadHtml(sale, fiscal, f),
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
    fiscalFootHtml(sale, fiscal, f),
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
