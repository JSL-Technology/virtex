import { gradeExtraction, inventedNumbers, languageOf, mentions, numbersIn } from './graders';

describe('evaluation graders', () => {
  it('reads numbers however they are written', () => {
    expect(numbersIn('RD$1,500.25 y 1.500,25 y 6.773,2 y 12 500')).toEqual([1500.25, 1500.25, 6773.2, 12, 500]);
    expect(numbersIn('$563.70 — 1,033')).toEqual([563.7, 1033]);
  });

  it('knows a figure stated in full, in thousands, or rounded', () => {
    expect(mentions('Te deben RD$152,300.50 en total', 152300.5)).toBe(true);
    expect(mentions('About 152.3 thousand', 152300.5)).toBe(true);
    expect(mentions('Te deben RD$15,230', 152300.5)).toBe(false);
  });

  it('flags numbers the facts do not hold, but not dates, years or small counts', () => {
    const facts = { balance: 'RD$61,000.00', dueDate: '2026-09-30', daysOverdue: 22 };
    expect(inventedNumbers('Su saldo de RD$61.000,00 venció el 30/09/2026, hace 22 días; 2 avisos.', facts)).toEqual([]);
    expect(inventedNumbers('Su saldo es RD$65,000.00', facts)).toEqual([65000]);
  });

  it('tells Spanish, English and Portuguese apart', () => {
    expect(languageOf('Te deben un total de 152 mil pesos y el cliente que más debe es el hotel.')).toBe('es');
    expect(languageOf('Your customers owe you a total of 152 thousand and the hotel owes the most.')).toBe('en');
    expect(languageOf('Os seus clientes devem um total de 152 mil e o hotel é o que mais deve.')).toBe('pt');
  });

  it('scores an extraction field by field', () => {
    const expected = { ncf: 'B0100000123', total: 6773.2, dueDate: null, lines: 2 };
    expect(gradeExtraction(expected, { ncf: 'b01-0000-0123', total: 6773.2, dueDate: null, lines: [{}, {}] })).toMatchObject({ pass: true, score: 1 });
    expect(gradeExtraction(expected, { ncf: 'B0100000123', total: 6773.21, dueDate: '2026-11-04', lines: [{}] })).toMatchObject({
      pass: false,
      failures: ['dueDate', 'lines'],
    });
  });
});
