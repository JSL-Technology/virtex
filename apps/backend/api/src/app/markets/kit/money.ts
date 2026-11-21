/**
 * Rounding, for a market package that computes.
 *
 * The core rounds with `common/money`; a market package depends on no module of the product
 * (docs/ARQUITECTURA_MERCADOS.md §2.4), so the same rule lives here for the engines that need it:
 * two decimals, half away from zero, which is how every currency this product keeps books in is
 * written and how an authority reads an amount.
 */
export function roundAmount(value: number): number {
  const cents = Math.round(Math.abs(Number(value ?? 0)) * 100 + Number.EPSILON);
  return (value < 0 ? -cents : cents) / 100;
}
