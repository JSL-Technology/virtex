import { LeaveService } from './leave.service';
import { LeaveKind, LeaveStatus } from '../entities/employee-leave.entity';

describe('LeaveService', () => {
  describe('the vacation the Labour Code grants', () => {
    it.each([
      [3, 0],
      [5, 6],
      [8, 9],
      [11, 12],
      [12, 14],
      [59, 14],
      [60, 18],
      [130, 18],
    ])('%i months of service → %i working days', (months, days) => {
      expect(LeaveService.entitlement(months)).toBe(days);
    });
  });

  it('counts completed months, not started ones', () => {
    expect(LeaveService.monthsBetween('2025-03-15', '2026-03-14')).toBe(11);
    expect(LeaveService.monthsBetween('2025-03-15', '2026-03-15')).toBe(12);
  });

  it('counts working days without weekends or fixed holidays', () => {
    // Mon 22 to Fri 26 December 2025: Christmas is out.
    expect(LeaveService.businessDays('2025-12-22', '2025-12-26')).toBe(4);
    // Sat to Sun: none.
    expect(LeaveService.businessDays('2026-10-31', '2026-11-01')).toBe(0);
  });

  describe('requests', () => {
    const make = (existing: unknown[] = []) => {
      const saved: unknown[] = [];
      const leaves: any = {
        find: jest.fn(async () => existing),
        create: (v: unknown) => v,
        save: jest.fn(async (v: unknown) => {
          saved.push(v);
          return v;
        }),
        createQueryBuilder: () => ({ where: () => qb, andWhere: () => qb, getCount: async () => 0 }),
      };
      const qb: any = { where: () => qb, andWhere: () => qb, getCount: async () => 0 };
      leaves.createQueryBuilder = () => qb;
      const employees: any = { findOne: jest.fn(async () => ({ id: 'e1', hireDate: '2020-01-06', organizationId: 'o' })) };
      return { service: new LeaveService(leaves, employees), saved };
    };

    it('a vacation records the service year it consumes', async () => {
      const { service } = make();
      const leave = await service.request('o', 'e1', { kind: LeaveKind.VACATION, startDate: '2026-11-02', endDate: '2026-11-06' }, 'u');
      expect(leave.businessDays).toBe(5);
      expect(leave.serviceYear).toBe(6);
      expect(leave.status).toBe(LeaveStatus.REQUESTED);
    });

    it('refuses a vacation beyond what is left of the year', async () => {
      const { service } = make([{ status: LeaveStatus.APPROVED, businessDays: 15 }]);
      await expect(
        service.request('o', 'e1', { kind: LeaveKind.VACATION, startDate: '2026-11-02', endDate: '2026-11-06' }, 'u'),
      ).rejects.toThrow();
    });

    it('a sick leave is not counted against the vacation', async () => {
      const { service } = make([{ status: LeaveStatus.APPROVED, businessDays: 18 }]);
      const leave = await service.request('o', 'e1', { kind: LeaveKind.SICK, startDate: '2026-11-02', endDate: '2026-11-03' }, 'u');
      expect(leave.serviceYear).toBeNull();
    });
  });
});
