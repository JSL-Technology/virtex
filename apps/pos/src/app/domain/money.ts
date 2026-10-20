/** Rounded to the cent, the way the server rounds every amount it stores. */
export function round2(value: number): number {
  const n = Number(value) || 0;
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
}

export function sum(values: readonly number[]): number {
  return round2(values.reduce((acc, value) => acc + (Number(value) || 0), 0));
}
