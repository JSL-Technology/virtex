import { descriptionSignature, documentReferences, scoreCandidate } from './reconciliation.service';

const tx = (description: string, date = '2026-10-03', reference: string | null = null) =>
  ({ description, date, reference, debit: 1500, credit: 0 }) as never;

describe('layered matching', () => {
  it('still requires the exact amount', () => {
    expect(scoreCandidate(tx('x'), 1500, { date: '2026-10-03', description: 'x', amount: 1499.99 }).score).toBe(0);
  });

  it('a document number both sides cite outranks a mere date match', () => {
    const cited = scoreCandidate(tx('DEP TRANSF FACT F-0012 CARIBE'), 1500, { date: '2026-10-05', description: 'Cobro factura F-0012', amount: 1500 });
    const plain = scoreCandidate(tx('DEP TRANSF FACT F-0012 CARIBE'), 1500, { date: '2026-10-05', description: 'Cobro', amount: 1500 });
    expect(cited.reasons).toContain('reference');
    expect(cited.score).toBeGreaterThan(plain.score);
  });

  it("rewards the counterparty's name and what this company matched before", () => {
    const result = scoreCandidate(tx('PAGO CLARO DOMINICANA'), 1500, { date: '2026-10-03', description: 'Factura Claro Dominicana octubre', amount: 1500 }, {
      learnedAccounts: new Set(['acc-telephone']),
      entryAccounts: new Set(['acc-telephone']),
    });
    expect(result.reasons).toEqual(expect.arrayContaining(['amount', 'same_day', 'words', 'learned']));
    expect(result.score).toBe(100);
  });

  it('reads invoice numbers, NCF and long references, and signatures without numbers', () => {
    expect([...documentReferences('PAGO FACT-00012 NCF B0100000123 REF 98765432')]).toEqual(
      expect.arrayContaining(['B0100000123', 'FACT-12', '98765432']),
    );
    expect(descriptionSignature('TRANSFERENCIA CLARO 0045 OCT')).toBe(descriptionSignature('Transferencia Claro 0099 oct'));
  });
});
