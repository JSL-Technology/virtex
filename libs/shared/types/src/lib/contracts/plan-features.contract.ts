import { composeKey } from '../i18n/key.contract';

/**
 * The capabilities a subscription plan grants or withholds, as both sides name them.
 *
 * The API decides with them (`@CheckFeature`, `EntitlementsPort`) and the client offers screens by
 * them (`ModuleRoute.feature`). They were declared in the API alone, so the client could not ask
 * the question and offered every screen to every plan: a company on the entry plan saw AI, group
 * consolidation and the manager's report in its menu, and each page answered 403 (IA-01, IA-02).
 * One list, imported by both, makes a key either side does not know a compile error.
 *
 * Every capability here is one the products this one is measured against sell as a step up. What
 * every plan includes — collections, reminders, the books — is not a feature at all: it is the
 * product (TES-13).
 */
export const SAAS_FEATURE_KEYS = [
  /** Group consolidation: consistent with the `SUBSIDIARIES` quota, which is 0 on the entry plan. */
  'group_consolidation',
  /** Per-tenant identity-provider configuration, on the tier the product calls Enterprise. */
  'enterprise_sso',
  /**
   * Photo-assisted product and bill entry. On every tier: metered by `AI_CREDITS`, so the entry
   * tier gets a taste rather than a free ride.
   */
  'ai_vision',
  /** Demand forecasting: a model per tenant every night. */
  'ai_forecasting',
  /** Anomaly detection: likewise. */
  'ai_anomalies',
  /** The copilot: a conversation that reads and drafts through the user's own permissions. */
  'ai_assistant',
  /** The projected cash flow and its scenarios. */
  'ai_cashflow',
  /** The assistant breaking ties in bank reconciliation. */
  'ai_reconciliation',
  /** The assistant writing collection notes. Collections itself is on every plan. */
  'ai_collections',
  /** The manager's monthly report. */
  'ai_manager_reports',
  /** Agents that prepare documents on their own. */
  'ai_agents',
] as const;

export type SaasFeatureKey = (typeof SAAS_FEATURE_KEYS)[number];

export function isSaasFeatureKey(value: unknown): value is SaasFeatureKey {
  return typeof value === 'string' && (SAAS_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * The catalogue key of a feature's name, as a person reads it («Detección de anomalías»). A refusal
 * names the feature with it rather than with its identifier, which is what the reader saw — the
 * key `ai_anomalies` — when a plan did not include it (IA-02).
 */
export function planFeatureLabelKey(feature: SaasFeatureKey): string {
  return composeKey('saas.features', feature);
}
