import { isValidBic, isValidIban } from './bank-identifiers.validator';

describe('bank identifiers', () => {
  it('acepta IBAN válidos con o sin espacios', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
  });

  it('rechaza basura y dígitos de control incorrectos (QA A-06)', () => {
    expect(isValidIban('###')).toBe(false);
    expect(isValidIban('DE89370400440532013001')).toBe(false);
  });

  it('valida BIC de 8 y 11 caracteres', () => {
    expect(isValidBic('DEUTDEFF')).toBe(true);
    expect(isValidBic('DEUTDEFF500')).toBe(true);
    expect(isValidBic('DEU1')).toBe(false);
  });
});
