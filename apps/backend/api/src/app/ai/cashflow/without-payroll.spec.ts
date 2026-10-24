import { withoutPayroll } from './cashflow.service';

describe('withoutPayroll', () => {
  it('folds payroll into other spending, so the totals stay and the wages line goes', () => {
    const projection = {
      metrics: { byComponent: { receivables: 100, new_spending: -40, payroll: -60 }, endP50: 1000 },
      days: [{ components: { new_spending: -1, payroll: -2.25 } }, { components: { receivables: 5 } }],
    };
    const out = withoutPayroll(projection);
    expect(out.metrics).toEqual({ byComponent: { receivables: 100, new_spending: -100 }, endP50: 1000 });
    expect(out.days[0].components).toEqual({ new_spending: -3.25 });
    expect(out.days[1].components).toEqual({ receivables: 5 });
    expect(JSON.stringify(out)).not.toContain('payroll');
  });
});
