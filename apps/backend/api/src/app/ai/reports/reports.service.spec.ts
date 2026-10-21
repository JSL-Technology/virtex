import { canReadReport, flatten, parseContent } from './reports.service';

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

describe('who may read a report', () => {
  const company = { audience: 'ORGANIZATION' as const, requiredPermissions: ['ai_reports:view', 'reports:view_financial'], requestedByUserId: null };
  const personal = { audience: 'REQUESTER' as const, requiredPermissions: ['ai_reports:view'], requestedByUserId: 'u-1' };

  it('a company-wide report needs every source permission and no branch limit', () => {
    expect(canReadReport(company, { id: 'u-1', permissions: ['ai_reports:view', 'reports:view_financial'], branches: null })).toBe(true);
    // The report permission alone is not a way around the income statement's own.
    expect(canReadReport(company, { id: 'u-2', permissions: ['ai_reports:view'], branches: null })).toBe(false);
    // Everything, but limited to a branch: the company's figures are not theirs.
    expect(canReadReport(company, { id: 'u-3', permissions: ['*'], branches: ['br-1'] })).toBe(false);
  });

  it('a personal report is its requester\'s alone, and only while they keep the permissions', () => {
    expect(canReadReport(personal, { id: 'u-1', permissions: ['ai_reports:view'], branches: ['br-1'] })).toBe(true);
    expect(canReadReport(personal, { id: 'u-2', permissions: ['*'], branches: null })).toBe(false);
    expect(canReadReport(personal, { id: 'u-1', permissions: [], branches: null })).toBe(false);
  });
});
