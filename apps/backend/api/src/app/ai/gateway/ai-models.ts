/**
 * Which model each AI feature uses, how hard it thinks, and what it costs.
 *
 * The choice of model is configuration (`AI_MODEL_*`), so moving a feature to a newer model is a
 * deploy setting rather than a code change; this file holds what the setting does not: the effort,
 * the output budget and the credits a call is charged. The reasoning for each default is in
 * docs/IA_PLAN_MAESTRO.md §4.1.
 */

/** The product features that call a language model. Also the `feature` column of `ai_requests`. */
export type AiFeature =
  | 'product_vision'
  | 'anomaly_narrative'
  | 'deep_analysis'
  | 'copilot'
  | 'bill_capture'
  | 'compose'
  | 'column_mapping'
  | 'reconcile_ambiguous';

export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiRoute {
  /** The env var naming the model; see `config/env.validation.ts` for its default. */
  readonly modelSetting: 'AI_MODEL_VISION' | 'AI_MODEL_NARRATIVE' | 'AI_MODEL_DEEP_ANALYSIS';
  readonly effort: AiEffort;
  readonly maxTokens: number;
  /** Plan credits one call consumes; see `SaasResource.AI_CREDITS`. */
  readonly credits: number;
}

export const AI_ROUTES: Readonly<Record<AiFeature, AiRoute>> = {
  // Reading a label in a photo is extraction, but a mis-read barcode or brand is a wrong catalogue
  // entry somebody has to notice: `high` effort, on the most capable interactive model.
  product_vision: { modelSetting: 'AI_MODEL_VISION', effort: 'high', maxTokens: 8_000, credits: 1 },
  // A paragraph written from structured evidence the engine already computed.
  anomaly_narrative: { modelSetting: 'AI_MODEL_NARRATIVE', effort: 'low', maxTokens: 2_000, credits: 1 },
  // Asynchronous analyses (manager's report, scenario simulation) where quality matters, not latency.
  deep_analysis: { modelSetting: 'AI_MODEL_DEEP_ANALYSIS', effort: 'high', maxTokens: 32_000, credits: 10 },
  // One model turn of the copilot (a question may take several, one per round of tool calls).
  // Interactive: `medium` keeps a turn to seconds; the numbers come from tools, not from reasoning.
  copilot: { modelSetting: 'AI_MODEL_VISION', effort: 'medium', maxTokens: 16_000, credits: 1 },
  // A supplier's invoice read into a draft bill: a wrong tax identifier or total is a wrong tax record.
  bill_capture: { modelSetting: 'AI_MODEL_VISION', effort: 'high', maxTokens: 12_000, credits: 2 },
  // A reminder or a covering note, written from facts the server supplies.
  compose: { modelSetting: 'AI_MODEL_NARRATIVE', effort: 'low', maxTokens: 4_000, credits: 1 },
  // A spreadsheet's headers mapped onto the dataset's columns.
  column_mapping: { modelSetting: 'AI_MODEL_NARRATIVE', effort: 'low', maxTokens: 4_000, credits: 1 },
  // Choosing between two bank-statement matches the deterministic score could not separate.
  reconcile_ambiguous: { modelSetting: 'AI_MODEL_NARRATIVE', effort: 'medium', maxTokens: 4_000, credits: 1 },
};

/** US dollars per million tokens. */
interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/**
 * Published list prices, used to put a cost on every call in `ai_requests`.
 *
 * The cost is an estimate for the tenant's usage screen and for overage decisions; the invoice of
 * record is Anthropic's. A model missing here is priced as the dearest one listed, so an unknown
 * model can only be over-reported, never shown as free.
 */
const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

const DEAREST: ModelPrice = MODEL_PRICES['claude-fable-5-1'];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Cost of a call in millionths of a dollar.
 *
 * A price per million tokens times a token count IS a number of millionths of a dollar, so this is
 * a sum of products with no division — and rounding happens once, at the end.
 */
export function costMicroUsd(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICES[model] ?? DEAREST;
  return Math.round(
    usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite,
  );
}

export function isPricedModel(model: string): boolean {
  return model in MODEL_PRICES;
}
