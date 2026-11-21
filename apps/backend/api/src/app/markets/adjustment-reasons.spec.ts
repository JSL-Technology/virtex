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
    expect(adjustmentCodeFor('DO', 'ANNULMENT', 'CREDIT_NOTE')).toBe('1');
    expect(adjustmentCodeFor('DO', 'DETAIL_CORRECTION', 'CREDIT_NOTE')).toBe('2');
    expect(adjustmentCodeFor('DO', 'GOODS_RETURN', 'CREDIT_NOTE')).toBe('3');
    expect(adjustmentCodeFor('DO', 'LATE_PAYMENT_INTEREST', 'DEBIT_NOTE')).toBe('3');
    expect(adjustmentCodeFor('do', 'OTHER', 'CREDIT_NOTE')).toBe('3');
    // A market whose authority publishes no catalogue of concepts at all: the SRI asks why in
    // words, and AFIP asks only which document is associated.
    expect(adjustmentCodeFor('EC', 'ANNULMENT', 'CREDIT_NOTE')).toBeNull();
    expect(adjustmentCodeFor('AR', 'ANNULMENT', 'CREDIT_NOTE')).toBeNull();
    // A market the product is not sold in, and no market at all.
    expect(adjustmentCodeFor('ZZ', 'ANNULMENT', 'CREDIT_NOTE')).toBeNull();
    expect(adjustmentCodeFor(null, 'ANNULMENT', 'CREDIT_NOTE')).toBeNull();
    // A note with no reason recorded has no code either: the caller decides what to do about it.
    expect(adjustmentCodeFor('DO', null, 'CREDIT_NOTE')).toBeNull();
  });

  /**
   * The code comes from the catalogue of the KIND of note that carries it.
   *
   * One flat record per market read the same code for both, and two authorities publish codes for
   * a credit note that their debit-note catalogue does not contain at all — so a debit note went
   * out coded under a concept its own catalogue does not define.
   */
  it('reads the code from the catalogue of the kind of note that carries it', () => {
    // SUNAT: «otros conceptos» is `10` in catálogo 09 and `03` in catálogo 10, which has three
    // entries and no `10`.
    expect(adjustmentCodeFor('PE', 'OTHER', 'CREDIT_NOTE')).toBe('10');
    expect(adjustmentCodeFor('PE', 'OTHER', 'DEBIT_NOTE')).toBe('03');
    // The DIAN's notas débito have four conceptos; `5` is a nota crédito's.
    expect(adjustmentCodeFor('CO', 'OTHER', 'CREDIT_NOTE')).toBe('5');
    expect(adjustmentCodeFor('CO', 'OTHER', 'DEBIT_NOTE')).toBe('4');
    // The SAT codes the relation rather than the reason: `01` this is a credit note of the related
    // document, `02` a debit note of it.
    expect(adjustmentCodeFor('MX', 'OTHER', 'CREDIT_NOTE')).toBe('01');
    expect(adjustmentCodeFor('MX', 'OTHER', 'DEBIT_NOTE')).toBe('02');

    // A reason that belongs to the other kind of note has no code here, rather than one from the
    // wrong catalogue: the regime then refuses the note instead of filing it under a concept
    // nobody chose.
    expect(adjustmentCodeFor('PE', 'ANNULMENT', 'DEBIT_NOTE')).toBeNull();
    expect(adjustmentCodeFor('PE', 'LATE_PAYMENT_INTEREST', 'CREDIT_NOTE')).toBeNull();
  });

  it('writes a code for every reason a note of that kind can carry, or none, in each of the nineteen markets', () => {
    for (const market of allMarkets()) {
      const codes = market.documents.adjustmentCodes;
      if (!codes) {
        for (const reason of ADJUSTMENT_REASONS) {
          expect(adjustmentCodeFor(market.code, reason, 'CREDIT_NOTE')).toBeNull();
          expect(adjustmentCodeFor(market.code, reason, 'DEBIT_NOTE')).toBeNull();
        }
        continue;
      }
      for (const reason of CREDIT_NOTE_REASONS) {
        expect([market.code, reason, adjustmentCodeFor(market.code, reason, 'CREDIT_NOTE')]).toEqual([
          market.code,
          reason,
          codes.creditNote[reason],
        ]);
      }
      for (const reason of DEBIT_NOTE_REASONS) {
        expect([market.code, reason, adjustmentCodeFor(market.code, reason, 'DEBIT_NOTE')]).toEqual([
          market.code,
          reason,
          codes.debitNote?.[reason] ?? null,
        ]);
      }
    }
  });

  it('publishes a debit-note catalogue wherever it both issues debit notes and codes its notes', () => {
    for (const market of allMarkets()) {
      const codes = market.documents.adjustmentCodes;
      if (!codes || !market.documents.debitNotes) continue;
      // Otherwise every debit note of that market would be refused at transmission for want of a
      // code — which is the right refusal, and the wrong place to discover it.
      expect([market.code, codes.debitNote === null]).toEqual([market.code, false]);
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
