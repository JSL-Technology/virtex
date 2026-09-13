import { DocumentTone } from '../../shared/components/gestures';
import { InvoiceStatus } from './invoices';

/**
 * How an invoice's stored status is shown: its catalogue key, its badge class and its tone.
 *
 * ## Why this is one table and not three
 *
 * The ledger stores the status as an English phrase — `Partially Paid`, `Credit Note` — and every
 * screen that had to show it wrote its own translation of that phrase into a catalogue key. There
 * were three such maps, and they had already diverged: the list's fell back to
 * `INVOICES.LIST.ESTADO_2` for anything it did not recognise, which is the word "Estado" itself, so
 * every DRAFT invoice in the register carried a badge reading **Status**. The catalogue had the
 * right entry, `INVOICES.STATUS.DRAFT`, the whole time; nothing pointed at it.
 *
 * A status the client has not been taught about now shows as itself rather than as a label that
 * looks deliberate, because an unknown value must be visible, not disguised.
 */
const STATUS: Record<InvoiceStatus, { key: string; badge: string; tone: DocumentTone }> = {
  Draft: { key: 'INVOICES.STATUS.DRAFT', badge: 'draft', tone: 'draft' },
  Pending: { key: 'INVOICES.STATUS.PENDING', badge: 'pending', tone: 'warning' },
  Paid: { key: 'INVOICES.STATUS.PAID', badge: 'paid', tone: 'ok' },
  'Partially Paid': {
    key: 'INVOICES.STATUS.PARTIALLY_PAID',
    badge: 'partially-paid',
    tone: 'warning',
  },
  Void: { key: 'INVOICES.STATUS.VOID', badge: 'void', tone: 'danger' },
  'Credit Note': { key: 'INVOICES.STATUS.CREDIT_NOTE', badge: 'credit-note', tone: 'neutral' },
};

/** The catalogue key for a stored status, or the status itself when it is not one we know. */
export function invoiceStatusKey(status: InvoiceStatus | string | null | undefined): string {
  if (!status) return 'COMMON.NOT_RECORDED';
  return STATUS[status as InvoiceStatus]?.key ?? status;
}

/** The badge modifier, so the same status is the same colour in every list. */
export function invoiceStatusClass(status: InvoiceStatus | string | null | undefined): string {
  if (!status) return 'unknown';
  return STATUS[status as InvoiceStatus]?.badge ?? 'unknown';
}

/** Semantic, never decorative: the tone says whether the document still admits work. */
export function invoiceStatusTone(status: InvoiceStatus | string | null | undefined): DocumentTone {
  if (!status) return 'neutral';
  return STATUS[status as InvoiceStatus]?.tone ?? 'neutral';
}
