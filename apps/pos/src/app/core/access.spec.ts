import { canAccessPos, canOperatePos, canSupervisePos } from './access';

describe('POS access', () => {
  it('the tenant administrator (wildcard) may do everything', () => {
    expect(canAccessPos(['*'])).toBe(true);
    expect(canOperatePos(['*'])).toBe(true);
    expect(canSupervisePos(['*'])).toBe(true);
  });

  it('a cashier role opens and sells but does not supervise', () => {
    const cashier = ['pos:view', 'pos:operate'];
    expect(canAccessPos(cashier)).toBe(true);
    expect(canOperatePos(cashier)).toBe(true);
    expect(canSupervisePos(cashier)).toBe(false);
  });

  it('a module wildcard grants the whole till', () => {
    expect(canSupervisePos(['pos:*'])).toBe(true);
  });

  it('an accountant without POS permissions has no access', () => {
    expect(canAccessPos(['invoices:view', 'accounting:*'])).toBe(false);
    expect(canAccessPos(undefined)).toBe(false);
  });
});
