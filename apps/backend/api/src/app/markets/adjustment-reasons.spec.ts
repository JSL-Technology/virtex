import { ADJUSTMENT_REASONS, CREDIT_NOTE_REASONS, DEBIT_NOTE_REASONS, reasonsOfPurpose } from './contracts';
import { adjustmentCodeFor } from './queries/documents';
import { allMarkets, knownMarket } from './registry';

/**
 * Why a note modifies a document already issued, and how each market writes it.
 *
 * The invoice used to store the DGII's `CodigoModificacion` — one authority's catalogue, on every
 * document of every market, accepted at the HTTP boundary from any tenant and derived from the
 * amount when nobody said why. The commercial fact is stored now, and the code is the market's.
 */
describe('canonical adjustment reasons', () => {
  it('names a commercial fact, never an authority code', () => {
    for (const reason of ADJUSTMENT_REASONS) {
      expect(reason).toMatch(/^[A-Z][A-Z_]+$/);
    }
    // Nine reasons, `OTHER` shared by both kinds of note and counted once.
    expect(ADJUSTMENT_REASONS).toHaveLength(9);
    expect(new Set(ADJUSTMENT_REASONS).size).toBe(ADJUSTMENT_REASONS.length);
  });

  it('separates what reduces a document from what adds to it', () => {
    expect(reasonsOfPurpose('CREDIT_NOTE')).toEqual(CREDIT_NOTE_REASONS);
    expect(reasonsOfPurpose('DEBIT_NOTE')).toEqual(DEBIT_NOTE_REASONS);
    // A credit note never charges interest, and a debit note never annuls what it modifies.
    expect(CREDIT_NOTE_REASONS).not.toContain('LATE_PAYMENT_INTEREST');
    expect(DEBIT_NOTE_REASONS).not.toContain('ANNULMENT');
    // Both may end in «another reason», with the words the issuer wrote.
    expect(CREDIT_NOTE_REASONS).toContain('OTHER');
    expect(DEBIT_NOTE_REASONS).toContain('OTHER');
  });

  it('turns the reason into the authority’s code only in the market that publishes it', () => {
    // The DGII's `CodigoModificacion`: 1 annuls, 2 corrects the text, 3 corrects amounts.
    expect(adjustmentCodeFor('DO', 'ANNULMENT')).toBe('1');
    expect(adjustmentCodeFor('DO', 'DETAIL_CORRECTION')).toBe('2');
    expect(adjustmentCodeFor('DO', 'GOODS_RETURN')).toBe('3');
    expect(adjustmentCodeFor('DO', 'LATE_PAYMENT_INTEREST')).toBe('3');
    expect(adjustmentCodeFor('do', 'OTHER')).toBe('3');
    // The same reason in a market that writes no code, and in one the product is not sold in.
    expect(adjustmentCodeFor('CL', 'ANNULMENT')).toBeNull();
    expect(adjustmentCodeFor('ZZ', 'ANNULMENT')).toBeNull();
    expect(adjustmentCodeFor(null, 'ANNULMENT')).toBeNull();
    // A note with no reason recorded has no code either: the caller decides what to do about it.
    expect(adjustmentCodeFor('DO', null)).toBeNull();
  });

  it('writes a code for every reason, or none, in each of the nineteen markets', () => {
    for (const market of allMarkets()) {
      const codes = market.documents.adjustmentCodes;
      if (!codes) {
        for (const reason of ADJUSTMENT_REASONS) expect(adjustmentCodeFor(market.code, reason)).toBeNull();
        continue;
      }
      for (const reason of ADJUSTMENT_REASONS) {
        expect([market.code, reason, adjustmentCodeFor(market.code, reason)]).toEqual([market.code, reason, codes[reason]]);
      }
    }
  });

  it('is declared by a market that issues notes at all', () => {
    for (const market of allMarkets()) {
      if (!market.documents.adjustmentCodes) continue;
      // A code explains a note to an authority, so the market has one and issues documents it reads.
      expect(knownMarket(market.code)?.documents.types.length).toBeGreaterThan(0);
    }
  });
});
