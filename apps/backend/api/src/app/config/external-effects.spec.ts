import { envValidation } from './env.validation';
import { externalEffectAllowed, ExternalEffect, ExternalEffectDisabledError, assertExternalEffectAllowed, parseExternalEffects } from './external-effects';

describe('external effects switch (FAC-EINV-02 / FE-CI-03)', () => {
  const withEnv = (nodeEnv: string | undefined, fn: () => void) => {
    const saved = process.env['NODE_ENV'];
    if (nodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = nodeEnv;
    try {
      fn();
    } finally {
      process.env['NODE_ENV'] = saved;
    }
  };

  it('is off by default in development and test, so CI never reaches a tax authority by accident', () => {
    withEnv('test', () => expect(externalEffectAllowed(ExternalEffect.FiscalAuthority, {})).toBe(false));
    withEnv('development', () => expect(externalEffectAllowed(ExternalEffect.FiscalAuthority, {})).toBe(false));
  });

  it('is on by default in any real deployment, including an unset or misspelled NODE_ENV', () => {
    for (const env of ['production', 'staging', 'prod', undefined]) {
      withEnv(env, () => expect(externalEffectAllowed(ExternalEffect.FiscalAuthority, {})).toBe(true));
    }
  });

  it('can be opted into deliberately, by kind', () => {
    withEnv('test', () => {
      expect(externalEffectAllowed(ExternalEffect.FiscalAuthority, { EXTERNAL_EFFECTS: 'fiscal_authority' })).toBe(true);
      expect(externalEffectAllowed(ExternalEffect.FiscalAuthority, { EXTERNAL_EFFECTS: 'all' })).toBe(true);
    });
    withEnv('production', () => expect(externalEffectAllowed(ExternalEffect.FiscalAuthority, { EXTERNAL_EFFECTS: 'none' })).toBe(false));
  });

  it('refuses an unknown kind instead of ignoring it', () => {
    expect(() => parseExternalEffects('fiscal_authorty', false)).toThrow(/unknown kinds: fiscal_authorty/);
  });

  it('throws a typed error that callers record as "not transmitted"', () => {
    withEnv('test', () => {
      expect(() => assertExternalEffectAllowed(ExternalEffect.FiscalAuthority, {})).toThrow(ExternalEffectDisabledError);
    });
  });

  it('boot validation: a real deployment cannot disable it, and typos fail at startup', () => {
    const validate = (env: Record<string, string>) =>
      envValidation.validate(env, { allowUnknown: true, abortEarly: false }).error?.details.map((d) => d.message) ?? [];
    const prod = { NODE_ENV: 'production' };
    expect(validate({ ...prod, EXTERNAL_EFFECTS: 'none' }).join(' ')).toMatch(/cannot be "none"/);
    expect(validate({ ...prod, EXTERNAL_EFFECTS: 'NONE' }).join(' ')).toMatch(/cannot be "none"/);
    expect(validate({ NODE_ENV: 'test', EXTERNAL_EFFECTS: 'fiscal_authorty' }).join(' ')).toMatch(/unknown kinds/);
    expect(validate({ NODE_ENV: 'test', EXTERNAL_EFFECTS: 'none' }).filter((m) => /EXTERNAL_EFFECTS/.test(m))).toEqual([]);
  });
});
