import { calibrate } from './autopilot';

const outcomes = (score: number, kept: number, undone: number) => [
  ...Array.from({ length: kept }, () => ({ score, undone: false })),
  ...Array.from({ length: undone }, () => ({ score, undone: true })),
];

describe('calibrate', () => {
  it('keeps the configured threshold until there is history to believe', () => {
    expect(calibrate([], 95)).toEqual({ minScore: 95, precision: null, samples: 0, pause: false });
    expect(calibrate(outcomes(95, 5, 1), 95)).toMatchObject({ minScore: 95, samples: 6, pause: false });
  });

  it('raises the threshold to where people stopped undoing', () => {
    const history = [...outcomes(95, 8, 3), ...outcomes(100, 40, 0)];
    expect(calibrate(history, 95).minScore).toBe(96);
    expect(calibrate([...outcomes(95, 30, 0), ...outcomes(100, 10, 0)], 95).minScore).toBe(95);
  });

  it('pauses an account whose automatic matches people keep undoing', () => {
    expect(calibrate([...outcomes(100, 18, 4)], 95)).toMatchObject({ pause: true, minScore: 100 });
    expect(calibrate([...outcomes(100, 40, 1)], 95)).toMatchObject({ pause: false, precision: 40 / 41 });
  });
});
