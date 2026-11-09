/**
 * The Dominican comprobante as received on a purchase — the Dominican market's own rule
 * (`markets/do/purchases.ts`), for the consumers that still name it. They move into the Dominican
 * package with the purchases phase of docs/ARQUITECTURA_MERCADOS.md.
 */
export {
  checkReceivedNcf,
  normalizeNcf,
  type ReceivedNcf,
  type ReceivedNcfCheck,
  type ReceivedNcfError,
  type ReceivedNcfWarning,
} from '../../markets/do/purchases';
