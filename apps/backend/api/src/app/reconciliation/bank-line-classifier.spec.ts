import { predictBankLine, trainBankLineModel } from './bank-line-classifier';

describe('bank line classifier', () => {
  const history = [
    ...Array.from({ length: 6 }, (_, i) => ({ description: `DEBITO CLARO DOMINICANA FACT ${1000 + i}`, amount: -2450 - i, label: 'telephone' })),
    ...Array.from({ length: 5 }, (_, i) => ({ description: `CARGO COMISION MANEJO AHORROS ${i}`, amount: -150, label: 'bank_fees' })),
    ...Array.from({ length: 4 }, (_, i) => ({ description: `INTERESES GANADOS AHORROS ${i}`, amount: 35 + i, label: 'interest_income' })),
    ...Array.from({ length: 5 }, (_, i) => ({ description: `PAGO EDESUR ENERGIA ${i}`, amount: -8900, label: 'electricity' })),
  ];
  const model = trainBankLineModel(history);

  it('learns which account a kind of bank line goes to, whatever its numbers', () => {
    const [best] = predictBankLine(model, 'DEBITO CLARO DOMINICANA FACT 99881', -2610);
    expect(best.label).toBe('telephone');
    expect(best.probability).toBeGreaterThan(0.9);
    expect(best.support).toBe(6);
    expect(best.evidence).toContain('claro');
  });

  it('uses the direction of the money', () => {
    expect(predictBankLine(model, 'AHORROS', 40)[0].label).toBe('interest_income');
    expect(predictBankLine(model, 'AHORROS', -150)[0].label).toBe('bank_fees');
  });

  it('says nothing about a line it has never seen the like of', () => {
    expect(predictBankLine(model, 'TRANSFERENCIA ZXQW', -500)).toEqual([]);
    expect(predictBankLine(trainBankLineModel([]), 'DEBITO CLARO', -10)).toEqual([]);
  });

  it('returns probabilities that add up to one', () => {
    const all = predictBankLine(model, 'PAGO CLARO ENERGIA', -100, 10);
    expect(all.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1, 6);
  });
});
