import { PayrollRunService } from './payroll-run.service';

/**
 * NOM-02 (audit 2026-10-31): a Mexican tenant started a run with `countryCode: "DO"` and it was
 * calculated under TSS rates, the DGII scale and Dominican pesos. A run follows the tenant's country.
 */
describe('PayrollRunService — the run follows the tenant country', () => {
  function service(tenantCountry: string) {
    const runs = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((row: unknown) => row),
      save: jest.fn(async (row: unknown) => ({ id: 'run-1', ...(row as object) })),
    };
    // Which countries have a payroll engine is the market registry's answer now, not a double's:
    // the Dominican package declares one and no other market does.
    const svc = new PayrollRunService(
      runs as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never,
      { resolve: jest.fn(async () => tenantCountry) } as never,
      {} as never, {} as never,
    );
    return { svc, runs };
  }

  it("refuses a run in another country's law", async () => {
    const { svc, runs } = service('MX');
    await expect(
      svc.createDraft({ countryCode: 'DO', periodYear: 2026, periodMonth: 8 } as never, 'org-mx'),
    ).rejects.toMatchObject({ messageKey: 'payroll.run_country_not_tenant_country' });
    expect(runs.save).not.toHaveBeenCalled();
  });

  it('accepts the tenant country, stated or not, in any case', async () => {
    const { svc } = service('DO');
    await expect(svc.createDraft({ periodYear: 2026, periodMonth: 8 } as never, 'org-do')).resolves.toMatchObject({ countryCode: 'DO' });
    await expect(svc.createDraft({ countryCode: 'do', periodYear: 2026, periodMonth: 9 } as never, 'org-do')).resolves.toMatchObject({ countryCode: 'DO' });
  });

  it('stores the run in the currency of the country whose law it follows', async () => {
    // `'DOP'` stood here for every tenant: a Mexican run was kept in pesos dominicanos, and every
    // amount on the payslip, in the ledger and in the filing carried a currency nobody had chosen.
    const { svc } = service('DO');
    await expect(svc.createDraft({ periodYear: 2026, periodMonth: 8 } as never, 'org-do')).resolves.toMatchObject({
      currencyCode: 'DOP',
    });
  });

  it('refuses a market whose payroll law the product has not modelled', async () => {
    const { svc, runs } = service('CO');
    await expect(svc.createDraft({ periodYear: 2026, periodMonth: 8 } as never, 'org-co')).rejects.toMatchObject({
      messageKey: 'payroll.payroll_jurisdiction_p1_not_supported',
    });
    expect(runs.save).not.toHaveBeenCalled();
  });
});
