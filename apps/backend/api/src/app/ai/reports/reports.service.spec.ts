import { flatten, parseContent } from './reports.service';

describe('report checks', () => {
  const facts = flatten({
    cashToday: 125000.5,
    tightestDate: '2026-11-14',
    shortfallChancePercent: 35,
    receivablesUnlikelyWithinAMonth: [{ customer: 'Tardío SRL', amount: 48250 }],
  });

  it('flattens nested facts into the paths the figure check reads', () => {
    expect(facts).toMatchObject({ cashToday: 125000.5, 'receivablesUnlikelyWithinAMonth.0.amount': 48250 });
  });

  const report = (summary: string) => ({
    title: 'Plan de caja',
    summary,
    sections: [{ heading: 'Cobros', body: 'Tardío SRL debe 48,250.00.' }],
    recommendations: [{ action: 'Llamar a Tardío SRL', why: 'Es el cobro más grande y el menos probable.' }],
  });

  it('accepts a report whose figures all come from the facts, however they are written', () => {
    expect(parseContent(report('Hoy hay RD$125,000.50; el punto más ajustado es el 2026-11-14 con un 35 % de riesgo.'), facts).sections).toHaveLength(1);
  });

  it('refuses a report that states a figure the facts do not contain', () => {
    expect(() => parseContent(report('Hoy hay RD$140,000.00 en caja.'), facts)).toThrow(/figures not in the facts/);
  });

  it('refuses an empty report', () => {
    expect(() => parseContent({ title: 'x', summary: '', sections: [], recommendations: [] }, facts)).toThrow(/empty/);
  });
});
