import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConceptCalculation, ConceptType } from '../entities/payroll-concept.entity';
import { CreateConceptDto } from './create-concept.dto';

/** QA M-04: a «Tasa» of 5000 overflowed the column and answered 500. */
describe('CreateConceptDto rate', () => {
  const base = { code: 'HE35', name: 'Horas extra', type: Object.values(ConceptType)[0] };
  const rateErrors = async (calculation: ConceptCalculation, rate: number) =>
    (await validate(plainToInstance(CreateConceptDto, { ...base, calculation, rate })))
      .filter((e) => e.property === 'rate')
      .flatMap((e) => Object.values(e.constraints ?? {}));

  it('reads a percentage as a fraction', async () => {
    expect(await rateErrors(ConceptCalculation.PERCENTAGE, 0.03)).toEqual([]);
    expect(await rateErrors(ConceptCalculation.PERCENTAGE, 5000)).toEqual(['payroll.concept_rate_is_a_fraction']);
  });

  it('bounds an hourly multiplier', async () => {
    expect(await rateErrors(ConceptCalculation.HOURLY, 1.35)).toEqual([]);
    expect(await rateErrors(ConceptCalculation.HOURLY, 5000)).toEqual(['payroll.concept_multiplier_too_high']);
  });

  it('refuses a negative rate', async () => {
    expect(await rateErrors(ConceptCalculation.FIXED, -1)).not.toEqual([]);
  });
});
