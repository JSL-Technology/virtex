import type { PosPayment } from '../core/pos-api.service';
import { round2 } from './money';

/** How the customer pays: one tender, or a card part plus a cash part. */
export type PayMethod = 'cash' | 'card' | 'transfer' | 'mixed';

export interface TenderDraft {
  method: PayMethod;
  /** Cash handed over (cash, or the cash part of a mixed payment). */
  cash: number | null;
  /** The card part of a mixed payment. */
  card: number | null;
  /** Card authorisation or transfer reference. */
  reference: string;
}

export function startTender(total: number): TenderDraft {
  return { method: 'cash', cash: round2(total), card: null, reference: '' };
}

/** What has been tendered so far. Card and transfer are charged for the exact total. */
export function paidSoFar(draft: TenderDraft, total: number): number {
  switch (draft.method) {
    case 'cash':
      return round2(draft.cash ?? 0);
    case 'mixed':
      return round2((draft.cash ?? 0) + (draft.card ?? 0));
    default:
      return round2(total);
  }
}

export function changeDue(draft: TenderDraft, total: number): number {
  return round2(Math.max(paidSoFar(draft, total) - total, 0));
}

export function stillOwed(draft: TenderDraft, total: number): number {
  return round2(Math.max(total - paidSoFar(draft, total), 0));
}

/**
 * Why the payment cannot be taken, as a catalogue key, or null. Only cash can produce change; a card
 * part larger than the total is a keying mistake. The server applies the same two rules
 * (`pos.payment_short`, `pos.payment_overpaid_non_cash`).
 */
export function paymentError(draft: TenderDraft, total: number): string | null {
  if (draft.method === 'mixed' && (draft.card ?? 0) > total) return 'pos.pay.card_exceeds_total';
  if (stillOwed(draft, total) > 0) return 'pos.pay.not_enough';
  return null;
}

/** The tenders as the server expects them. */
export function tenders(draft: TenderDraft, total: number): PosPayment[] {
  const reference = draft.reference.trim() || undefined;
  switch (draft.method) {
    case 'cash':
      return [{ method: 'cash', amount: round2(draft.cash ?? 0) }];
    case 'card':
      return [{ method: 'card', amount: round2(total), reference }];
    case 'transfer':
      return [{ method: 'transfer', amount: round2(total), reference }];
    case 'mixed': {
      const parts: PosPayment[] = [];
      if ((draft.card ?? 0) > 0) parts.push({ method: 'card', amount: round2(draft.card ?? 0), reference });
      if ((draft.cash ?? 0) > 0) parts.push({ method: 'cash', amount: round2(draft.cash ?? 0) });
      return parts;
    }
  }
}

/** Denominations a cashier is commonly handed, across the product's currencies. */
const NOTE_STEPS = [1, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];

/**
 * Cash amounts a cashier is likely handed for this total: the exact amount, then the next round
 * notes above it — at most five, smallest first.
 */
export function cashSuggestions(total: number): number[] {
  if (total <= 0) return [];
  const options = new Set<number>([round2(total)]);
  for (const step of NOTE_STEPS) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total && rounded / total < 25) options.add(rounded);
  }
  return [...options].sort((a, b) => a - b).slice(0, 5);
}
