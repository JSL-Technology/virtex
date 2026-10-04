import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TaxType } from '../entities/tax.entity';
import { CreateTaxDto } from './create-tax.dto';

/** QA M-04: a 150 % tax was accepted. */
describe('CreateTaxDto', () => {
  const errors = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(CreateTaxDto, body))).map((e) => e.property);

  it('refuses a percentage above 100', async () => {
    expect(await errors({ name: 'ITBIS', rate: 150 })).toContain('rate');
    expect(await errors({ name: 'ITBIS', rate: 150, type: TaxType.PERCENTAGE })).toContain('rate');
  });

  it('accepts a real percentage, and a fixed amount of any size', async () => {
    expect(await errors({ name: 'ITBIS', rate: 18 })).toEqual([]);
    expect(await errors({ name: 'Selectivo', rate: 150, type: TaxType.FIXED })).toEqual([]);
  });
});
