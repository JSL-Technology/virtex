import { cashSuggestions, changeDue, paymentError, startTender, stillOwed, tenders } from './payment';

describe('payment', () => {
  it('cash: change out of what was handed over', () => {
    const draft = { ...startTender(453.3), cash: 500 };
    expect(changeDue(draft, 453.3)).toBe(46.7);
    expect(paymentError(draft, 453.3)).toBeNull();
    expect(tenders(draft, 453.3)).toEqual([{ method: 'cash', amount: 500 }]);
  });

  it('cash short of the total cannot be taken', () => {
    const draft = { ...startTender(100), cash: 80 };
    expect(stillOwed(draft, 100)).toBe(20);
    expect(paymentError(draft, 100)).toBe('pos.pay.not_enough');
  });

  it('card and transfer are charged for the exact total, with the reference', () => {
    expect(tenders({ method: 'card', cash: null, card: null, reference: ' 0042 ' }, 99.99)).toEqual([
      { method: 'card', amount: 99.99, reference: '0042' },
    ]);
    expect(changeDue({ method: 'transfer', cash: 999, card: null, reference: '' }, 50)).toBe(0);
  });

  it('mixed: card part plus cash part; only the cash can produce change', () => {
    const draft = { method: 'mixed' as const, card: 60, cash: 50, reference: '' };
    expect(changeDue(draft, 100)).toBe(10);
    expect(tenders(draft, 100)).toEqual([
      { method: 'card', amount: 60, reference: undefined },
      { method: 'cash', amount: 50 },
    ]);
    expect(paymentError({ ...draft, card: 120 }, 100)).toBe('pos.pay.card_exceeds_total');
  });

  it('suggests the exact amount and the next round notes, smallest first', () => {
    expect(cashSuggestions(453.3)).toEqual([453.3, 454, 455, 460, 500]);
    expect(cashSuggestions(0)).toEqual([]);
  });
});
