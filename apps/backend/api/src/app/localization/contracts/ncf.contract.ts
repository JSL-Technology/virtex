/**
 * Received comprobantes (NCF / e-CF), as other modules may check them. The rules live with the
 * country catalogue in `fiscal/`; a purchase checks the number it was given through here.
 */
export {
  checkReceivedNcf,
  normalizeNcf,
  type ReceivedNcf,
  type ReceivedNcfCheck,
  type ReceivedNcfError,
  type ReceivedNcfWarning,
} from '../fiscal/ncf';
