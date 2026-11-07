/**
 * A supplier's document number reduced to what identifies it (AP-03).
 *
 * The same invoice is typed as "FAC-000123", "fac 123" or "FAC000123" depending on who enters it
 * and from what. Case, spaces and the usual separators are dropped, and so are the zeros a number
 * is padded with — each run of digits loses its leading zeros — so all three compare equal while
 * "FAC-123" and "FAC-1230" do not. NULL when nothing identifying is left.
 */
export function supplierInvoiceKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-_./\\#:]+/g, '')
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ''));
  return compact.length ? compact.slice(0, 60) : null;
}
