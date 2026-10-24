import { BILL_CAPTURE_CASES, COPILOT_CASES, INJECTION_CASES, NARRATIVE_CASES } from './cases';
import { checkSupplierTaxId } from '../app/localization/fiscal/purchase-capture-profile';
import { checkReceivedDocument } from '../app/localization/fiscal/received-document';
import { numbersOf } from './graders';

/**
 * The cases themselves are checked in every build: a case whose expected answer is wrong would
 * grade the model against a mistake.
 */
describe('AI evaluation cases', () => {
  const all = [
    ...BILL_CAPTURE_CASES.cases,
    ...COPILOT_CASES.cases,
    ...INJECTION_CASES.billCapture,
    ...INJECTION_CASES.copilot,
    ...NARRATIVE_CASES.anomalies,
    ...NARRATIVE_CASES.reminders,
  ];

  it('have unique ids and a supported country and language', () => {
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    for (const item of all) {
      expect(['DO', 'MX', 'US']).toContain(item.country);
      expect(['es', 'en', 'pt']).toContain(item.language);
    }
  });

  it('cover every pilot market for every feature', () => {
    for (const set of [BILL_CAPTURE_CASES.cases, COPILOT_CASES.cases, NARRATIVE_CASES.anomalies, NARRATIVE_CASES.reminders]) {
      expect(new Set(set.map((item) => item.country))).toEqual(new Set(['DO', 'MX', 'US']));
    }
    expect(new Set(COPILOT_CASES.cases.map((item) => item.language))).toEqual(new Set(['es', 'en']));
  });

  it('expect bills whose identifiers and arithmetic are right by the market\'s own rules', () => {
    for (const item of [...BILL_CAPTURE_CASES.cases, ...INJECTION_CASES.billCapture]) {
      const expected = item.expected;
      if (typeof expected['supplierTaxId'] === 'string') {
        expect({ id: item.id, valid: checkSupplierTaxId(item.country, expected['supplierTaxId'] as string).valid }).not.toEqual({ id: item.id, valid: false });
      }
      if (typeof expected['ncf'] === 'string') {
        expect({ id: item.id, status: checkReceivedDocument(item.country, expected['ncf'] as string).status }).not.toEqual({ id: item.id, status: 'invalid' });
      }
      if (typeof expected['subtotal'] === 'number' && typeof expected['total'] === 'number') {
        const sum = (expected['subtotal'] as number) + Number(expected['taxAmount'] ?? 0) + Number(expected['serviceCharge'] ?? 0);
        expect({ id: item.id, total: Math.round(sum * 100) / 100 }).toEqual({ id: item.id, total: expected['total'] });
      }
    }
  });

  it('expect copilot answers that the tools can support', () => {
    for (const item of [...COPILOT_CASES.cases, ...INJECTION_CASES.copilot]) {
      for (const tool of item.expect.tools) expect(Object.keys(item.tools)).toContain(tool);
      const available = numbersOf(item.tools);
      for (const figure of item.expect.mentions ?? []) expect({ id: item.id, figure, there: available.includes(figure) }).toEqual({ id: item.id, figure, there: true });
    }
  });

  it('plant a canary in every injection case', () => {
    for (const item of [...INJECTION_CASES.billCapture, ...INJECTION_CASES.copilot]) {
      expect(item.canary).toBeTruthy();
      expect(JSON.stringify(item)).toContain(item.canary as string);
    }
  });
});
