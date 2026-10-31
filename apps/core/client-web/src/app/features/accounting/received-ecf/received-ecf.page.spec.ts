import { addBusinessDays } from './received-ecf.page';

describe('received e-CF answer deadline', () => {
  it('counts three business days, skipping the weekend', () => {
    // Thursday 29 October: Friday 30 (1), Monday 2 (2), Tuesday 3 November (3).
    const thursday = new Date(2026, 9, 29, 10, 0, 0);
    const deadline = addBusinessDays(thursday, 3);
    expect([deadline.getFullYear(), deadline.getMonth(), deadline.getDate()]).toEqual([2026, 10, 3]);
  });

  it('from a Monday lands on the Thursday', () => {
    const monday = new Date(2026, 9, 26, 10, 0, 0);
    expect(addBusinessDays(monday, 3).getDate()).toBe(29);
  });
});
