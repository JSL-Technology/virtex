import { SeveranceService } from './severance.service';

describe('SeveranceService', () => {
  const service = new SeveranceService();

  it('computes preaviso, cesantía, vacaciones and regalía for a long tenure', () => {
    const r = service.computeTermination({
      monthlySalary: 30000,
      hireDate: '2020-01-15',
      endDate: '2026-01-14',
      monthsWorkedThisYear: 12,
    });

    // 5 completed years (71 months): Art. 76 preaviso 28 days, Art. 80 cesantía 5×21, vacaciones 18.
    expect(r.completedYears).toBe(5);
    expect(r.preavisoDays).toBe(28);
    expect(r.cesantiaDays).toBe(105);
    expect(r.vacationDays).toBe(18);
    expect(r.dailySalary).toBe(1258.92); // 30000 ÷ 23.83

    const expectedTotal =
      r.preavisoAmount + r.cesantiaAmount + r.vacationAmount + r.regaliaAmount;
    expect(r.total).toBe(Math.round(expectedTotal * 100) / 100);
    expect(r.preavisoAmount).toBeGreaterThan(0);
  });

  it('pays no preaviso or cesantía under three months', () => {
    const r = service.computeTermination({
      monthlySalary: 30000,
      hireDate: '2026-01-01',
      endDate: '2026-02-15',
    });
    expect(r.preavisoDays).toBe(0);
    expect(r.cesantiaDays).toBe(0);
  });

  it('uses the 6/13-day cesantía bands between three and twelve months', () => {
    const sixToTwelve = service.computeTermination({
      monthlySalary: 24000,
      hireDate: '2025-06-01',
      endDate: '2026-01-31',
    });
    expect(sixToTwelve.cesantiaDays).toBe(13);
    expect(sixToTwelve.preavisoDays).toBe(14);
  });

  it('computes regalía as one twelfth of the salary earned in the year', () => {
    expect(service.regalia({ monthlySalary: 30000, hireDate: '2026-01-01', endDate: '2026-06-30', monthsWorkedThisYear: 6 })).toBe(15000);
    expect(service.regalia({ monthlySalary: 30000, hireDate: '2020-01-01', endDate: '2026-12-31', monthsWorkedThisYear: 12 })).toBe(30000);
  });
});
