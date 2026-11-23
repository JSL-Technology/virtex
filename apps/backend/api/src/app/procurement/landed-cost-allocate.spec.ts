import { allocate } from './landed-costs.service';

/** The shares of a landed cost add up to it exactly, cents by largest remainder (CMP-21). */
describe('landed cost allocation', () => {
  it('splits by weight and keeps the total to the cent', () => {
    // 100 over values 300 / 300 / 400 → 30 / 30 / 40.
    expect(allocate(100, [300, 300, 400])).toEqual([30, 30, 40]);
    // 100 over three equal lines → 33.34 / 33.33 / 33.33: the odd cent goes to the first.
    const thirds = allocate(100, [1, 1, 1]);
    expect(thirds).toEqual([33.34, 33.33, 33.33]);
    expect(thirds.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });

  it('refuses a base with nothing to allocate over', () => {
    expect(() => allocate(10, [0, 0])).toThrow();
  });
});
