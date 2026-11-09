/**
 * Check-digit algorithms, addressable by name — each market declares its own in
 * `markets/<cc>/identity.ts`. Names are contract: they are persisted in
 * `identity_document_types.checksum`.
 */
export {
  CHECKSUM_ALGORITHMS,
  CHECKSUM_ALGORITHM_NAMES,
  STRUCTURAL_CHECKS,
  resolveChecksum,
  type ChecksumAlgorithm,
} from '../../markets';
