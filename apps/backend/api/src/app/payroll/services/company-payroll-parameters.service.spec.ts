import { BadRequestError } from '../../i18n/localized.exception';
import { RecordCompanyParameterDto } from '../dto/company-parameter.dto';
import { CompanyPayrollParameter } from '../entities/company-payroll-parameter.entity';
import { CompanyPayrollParametersService, validatedValues } from './company-payroll-parameters.service';

/**
 * Company payroll parameters (QA C-06): a US company's FICA, Medicare and FUTA as editable statutory
 * defaults, and the figures only it can enter. Every figure is dated; recording a new one closes the
 * window of the previous one instead of overwriting it.
 */
describe('company payroll parameters', () => {
  const dto = (overrides: Partial<RecordCompanyParameterDto>): RecordCompanyParameterDto =>
    Object.assign(new RecordCompanyParameterDto(), {
      code: 'FICA_SOCIAL_SECURITY',
      name: 'Social Security (FICA)',
      kind: 'CONTRIBUTION',
      effectiveFrom: '2027-01-01',
      employeeRate: 0.062,
      employerRate: 0.062,
      wageBase: 190_000,
      ...overrides,
    });

  describe('validatedValues', () => {
    it('keeps only the figures a contribution is made of', () => {
      expect(validatedValues(dto({ amount: 5 }))).toEqual({
        employeeRate: 0.062,
        employerRate: 0.062,
        wageBase: 190_000,
        threshold: null,
        creditRate: null,
        amount: null,
        brackets: null,
      });
    });

    it('needs at least one side of a rate', () => {
      expect(() => validatedValues(dto({ employeeRate: undefined, employerRate: undefined }))).toThrow(BadRequestError);
    });

    it('accepts a contiguous withholding table and sorts it', () => {
      const values = validatedValues(
        dto({
          kind: 'TABLE',
          brackets: [
            { over: 11_925, upTo: null, rate: 0.12, baseAmount: 1_192.5 },
            { over: 0, upTo: 11_925, rate: 0.1, baseAmount: 0 },
          ],
        }),
      );
      expect(values.brackets?.map((bracket) => bracket.over)).toEqual([0, 11_925]);
      expect(values.employeeRate).toBeNull();
    });

    it('refuses a table with a gap or one that does not start at zero', () => {
      expect(() =>
        validatedValues(dto({ kind: 'TABLE', brackets: [{ over: 100, upTo: null, rate: 0.1, baseAmount: 0 }] })),
      ).toThrow(BadRequestError);
      expect(() =>
        validatedValues(
          dto({
            kind: 'TABLE',
            brackets: [
              { over: 0, upTo: 1000, rate: 0.1, baseAmount: 0 },
              { over: 2000, upTo: null, rate: 0.2, baseAmount: 100 },
            ],
          }),
        ),
      ).toThrow(BadRequestError);
    });
  });

  describe('recording a figure', () => {
    let rows: CompanyPayrollParameter[];

    const row = (overrides: Partial<CompanyPayrollParameter>): CompanyPayrollParameter =>
      Object.assign(new CompanyPayrollParameter(), {
        id: 'p-2026',
        organizationId: 'org',
        countryCode: 'US',
        code: 'FICA_SOCIAL_SECURITY',
        name: 'Social Security (FICA)',
        kind: 'CONTRIBUTION',
        jurisdiction: '',
        employeeRate: 0.062,
        employerRate: 0.062,
        wageBase: 184_500,
        currencyCode: 'USD',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        source: 'STATUTORY_DEFAULT',
        legalBasis: 'IRC §3101(a)',
        requiresInput: false,
        active: true,
        ...overrides,
      });

    function service() {
      const repo = {
        findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const date = where['effectiveFrom'];
          if (typeof date === 'string') return rows.find((r) => r.effectiveFrom === date) ?? null;
          return rows.find((r) => r.effectiveTo === null) ?? null;
        }),
        save: jest.fn(async (r: CompanyPayrollParameter) => r),
        create: jest.fn(() => new CompanyPayrollParameter()),
        merge: jest.fn((target: CompanyPayrollParameter, patch: Partial<CompanyPayrollParameter>) =>
          Object.assign(target, patch),
        ),
      };
      const manager = { getRepository: () => repo };
      const parameters = {
        manager: { transaction: (work: (m: typeof manager) => unknown) => work(manager) },
        query: jest.fn(async () => [{ base_currency: 'USD' }]),
      };
      const tenantCountry = { resolveOrNull: jest.fn(async () => 'US') };
      return { svc: new CompanyPayrollParametersService(parameters as never, tenantCountry as never), repo };
    }

    it('closes the figure in force the day before the new one starts', async () => {
      const current = row({});
      rows = [current];
      const { svc } = service();
      const saved = await svc.record(dto({}), 'org');
      expect(current.effectiveTo).toBe('2026-12-31');
      expect(saved).toMatchObject({ effectiveFrom: '2027-01-01', wageBase: 190_000, source: 'COMPANY', effectiveTo: null });
    });

    it('fills a placeholder seeded without figures instead of closing it', async () => {
      const placeholder = row({
        code: 'STATE_UNEMPLOYMENT',
        employeeRate: null,
        employerRate: null,
        wageBase: null,
        requiresInput: true,
      });
      rows = [placeholder];
      const { svc } = service();
      const saved = await svc.record(
        dto({ code: 'STATE_UNEMPLOYMENT', employeeRate: 0, employerRate: 0.027, wageBase: 9_000, effectiveFrom: '2026-10-01' }),
        'org',
      );
      expect(saved).toBe(placeholder);
      expect(saved).toMatchObject({ requiresInput: false, employerRate: 0.027, effectiveTo: null });
    });
  });
});
