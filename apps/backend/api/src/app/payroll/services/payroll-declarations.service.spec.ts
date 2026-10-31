import { PayrollDeclarationsService } from './payroll-declarations.service';
import { PayrollRunStatus } from '../entities/payroll-run.entity';

describe('PayrollDeclarationsService', () => {
  const slips = [
    { employeeId: 'e1', employeeName: 'Ana Pérez', grossEarnings: 60000, afpEmployee: 1722, sfsEmployee: 1824, taxableBase: 56454, incomeTax: 2200.5, netPay: 54253.5 },
    { employeeId: 'e2', employeeName: 'Luis Gómez', grossEarnings: 25000, afpEmployee: 717.5, sfsEmployee: 760, taxableBase: 23522.5, incomeTax: 0, netPay: 23522.5 },
  ];
  const employees = [
    { id: 'e1', identityDocument: '001-1234567-8', bankName: 'Banreservas', bankAccountNumber: '960-123456-7', bankAccountType: 'Ahorros' },
    { id: 'e2', identityDocument: null, bankName: null, bankAccountNumber: null, bankAccountType: null },
  ];
  const make = (status = PayrollRunStatus.APPROVED) =>
    new PayrollDeclarationsService(
      {
        find: jest.fn(async () => [{ id: 'r1', name: 'Nómina octubre' }]),
        findOne: jest.fn(async () => ({ id: 'r1', status, periodYear: 2026, periodMonth: 10 })),
      } as never,
      { find: jest.fn(async () => slips) } as never,
      { find: jest.fn(async () => employees) } as never,
    );

  it('the IR-3 lists each employee with gross, social security, taxable base and ISR', async () => {
    const ir3 = await make().ir3('org', 2026, 10);
    expect(ir3.period).toBe('202610');
    expect(ir3.rows[0]).toEqual({
      employeeId: 'e1', employeeName: 'Ana Pérez', identityDocument: '00112345678',
      grossEarnings: 60000, socialSecurity: 3546, taxableBase: 56454, incomeTax: 2200.5,
    });
    expect(ir3.totals).toEqual({ employees: 2, grossEarnings: 85000, socialSecurity: 5023.5, taxableBase: 79976.5, incomeTax: 2200.5 });
    expect(ir3.missingIdentity).toBe(1);
  });

  it('the bank file pays net wages and names who has no account', async () => {
    const file = await make().bankFile('org', 'r1', 'GENERIC');
    expect(file.transfers).toBe(1);
    expect(file.total).toBe(54253.5);
    expect(file.withoutAccount).toEqual(['Luis Gómez']);
    const [header, row] = file.body.split('\r\n');
    expect(header).toBe('identityDocument,employeeName,bankName,accountType,accountNumber,amount,reference');
    expect(row).toBe('00112345678,Ana Pérez,Banreservas,AHORRO,9601234567,54253.50,NOMINA 202610');
  });

  it('refuses a run that is not approved, and an unknown layout', async () => {
    await expect(make(PayrollRunStatus.CALCULATED).bankFile('org', 'r1')).rejects.toThrow();
    await expect(make().bankFile('org', 'r1', 'NOPE')).rejects.toThrow();
  });
});
