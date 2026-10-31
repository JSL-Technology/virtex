import { PosFiscalService } from './pos-fiscal.service';
import { PaymentMethod } from '../invoices/entities/invoice.entity';

/** The arithmetic that decides where a till sale's money lands and what its e-CF says about it. */
describe('PosFiscalService', () => {
  describe('tenderTotals', () => {
    it('counts cash net of change, and card and transfer at their face', () => {
      expect(
        PosFiscalService.tenderTotals(
          [
            { method: 'cash', amount: 500 },
            { method: 'card', amount: 300 },
            { method: 'transfer', amount: 100 },
          ],
          450,
          850,
        ),
      ).toEqual({ cash: 450, card: 300, transfer: 100 });
    });

    it('treats a sale from an older till with no tenders as cash for its total', () => {
      expect(PosFiscalService.tenderTotals([], 0, 118)).toEqual({ cash: 118, card: 0, transfer: 0 });
    });
  });

  describe('paymentKind (the e-CF FormaPago)', () => {
    it('maps a single tender to its kind', () => {
      expect(PosFiscalService.paymentKind([{ method: 'cash', amount: 1 }], null)).toBe(PaymentMethod.CASH);
      expect(PosFiscalService.paymentKind([{ method: 'card', amount: 1 }], null)).toBe(PaymentMethod.CREDIT_CARD);
      expect(PosFiscalService.paymentKind([{ method: 'transfer', amount: 1 }], null)).toBe(PaymentMethod.BANK_TRANSFER);
    });

    it('a mixed payment is «other»', () => {
      expect(
        PosFiscalService.paymentKind(
          [
            { method: 'cash', amount: 1 },
            { method: 'card', amount: 1 },
          ],
          null,
        ),
      ).toBe(PaymentMethod.OTHER);
    });

    it('falls back to the sale\'s named method, cash when none', () => {
      expect(PosFiscalService.paymentKind([], null)).toBe(PaymentMethod.CASH);
      expect(PosFiscalService.paymentKind([], 'card')).toBe(PaymentMethod.CREDIT_CARD);
    });
  });
});
