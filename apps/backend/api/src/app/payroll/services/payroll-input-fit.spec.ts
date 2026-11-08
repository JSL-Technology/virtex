import { assertInputFitsConcept } from './payroll-input.service';
import { ConceptCalculation } from '../entities/payroll-concept.entity';

/**
 * A run input carries what its concept reads, within the concept's own limits (audit 2026-11-07,
 * NOM-03, NOM-05). Checked when the input is captured, so the mistake is refused where it is made
 * and not discovered at calculation.
 */
describe('a payroll input against its concept', () => {
  const fixed = { code: 'QAPRE', calculation: ConceptCalculation.FIXED };
  const percentage = { code: 'QACOM', calculation: ConceptCalculation.PERCENTAGE };
  const hourly = { code: 'HE35', calculation: ConceptCalculation.HOURLY };
  const refusal = (key: string) => expect.objectContaining({ messageKey: key });

  it('refuses a negative amount, hours or rate', () => {
    expect(() => assertInputFitsConcept({ conceptCode: 'QAPRE', amount: -20000 }, fixed)).toThrow(refusal('payroll.input_does_not_fit_concept'));
    expect(() => assertInputFitsConcept({ conceptCode: 'HE35', quantity: -3 }, hourly)).toThrow(refusal('payroll.input_does_not_fit_concept'));
    expect(() => assertInputFitsConcept({ conceptCode: 'QACOM', rate: -0.1 }, percentage)).toThrow(refusal('payroll.input_does_not_fit_concept'));
  });

  it('holds a rate override to the ceiling the concept itself has', () => {
    expect(() => assertInputFitsConcept({ conceptCode: 'QACOM', rate: 50 }, percentage)).toThrow(refusal('payroll.concept_rate_is_a_fraction'));
    expect(() => assertInputFitsConcept({ conceptCode: 'QACOM', rate: 0.05 }, percentage)).not.toThrow();
    expect(() => assertInputFitsConcept({ conceptCode: 'HE35', quantity: 8, rate: 12 }, hourly)).toThrow(refusal('payroll.concept_multiplier_too_high'));
    expect(() => assertInputFitsConcept({ conceptCode: 'HE35', quantity: 8, rate: 2 }, hourly)).not.toThrow();
  });

  it('refuses the fields a calculation does not read', () => {
    expect(() => assertInputFitsConcept({ conceptCode: 'QAPRE', amount: 100, rate: 0.5 }, fixed)).toThrow(refusal('payroll.input_does_not_fit_concept'));
    expect(() => assertInputFitsConcept({ conceptCode: 'QACOM', amount: 100 }, percentage)).toThrow(refusal('payroll.input_does_not_fit_concept'));
    expect(() => assertInputFitsConcept({ conceptCode: 'HE35', amount: 100 }, hourly)).toThrow(refusal('payroll.input_does_not_fit_concept'));
    expect(() => assertInputFitsConcept({ conceptCode: 'QAPRE', amount: 1500 }, fixed)).not.toThrow();
  });
});
