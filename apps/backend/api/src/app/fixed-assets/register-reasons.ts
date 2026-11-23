/**
 * The reasons the fixed-asset register posts its own entries with: one list, so the reconciliation
 * traces every one of them by construction and none can be named as the source of an asset.
 *
 * The reconciliation once listed three of them by hand; the months a disposal's own run charges
 * posted with a fourth, and read as 6 000 the ledger had «with no asset behind it» on an
 * accumulated depreciation account that agreed to the cent (audit 2026-11-07, FINB-15).
 */
export const REGISTER_REASON = {
  /** An asset's acquisition, posted by the register (FINB-15). */
  acquisition: 'fixed-asset-acquisition',
  /** An asset's disposal: its derecognition, and the charge of the month it leaves in. */
  disposal: 'fixed-asset-disposal',
  /** A run's charge of a month. */
  depreciationRun: 'depreciation-run',
  /** The months a disposal's own run charged before the asset left. */
  disposalRun: 'asset-disposal',
} as const;

export type RegisterReason = (typeof REGISTER_REASON)[keyof typeof REGISTER_REASON];

/** Every reason the register posts with. */
export const REGISTER_REASONS: readonly RegisterReason[] = Object.values(REGISTER_REASON);

/**
 * The register's entries traced whatever asset they name: its disposals and its depreciation. An
 * acquisition is traced only while it is its asset's current one — one replaced since is not.
 */
export const TRACED_REASONS: readonly RegisterReason[] = [REGISTER_REASON.disposal, REGISTER_REASON.depreciationRun, REGISTER_REASON.disposalRun];

/** `reasons` as an SQL list of literals — they are constants of this file, never input. */
export function reasonsSql(reasons: readonly RegisterReason[]): string {
  return `(${reasons.map((reason) => `'${reason}'`).join(', ')})`;
}
