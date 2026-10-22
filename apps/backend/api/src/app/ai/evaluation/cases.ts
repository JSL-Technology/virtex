import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read from the source tree: the cases are data for the evaluation run, not part of the built app. */
function load(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'cases', name), 'utf8'));
}

/**
 * The evaluation cases (H-A5): versioned with the code, by feature, country and language. A
 * prompt change is judged against them before it ships; a new market adds its cases here.
 */
export type EvalCountry = 'DO' | 'MX' | 'US';
export type EvalLanguage = 'es' | 'en' | 'pt';

export interface BillCaptureCase {
  id: string;
  country: EvalCountry;
  language: EvalLanguage;
  document: string;
  expected: Record<string, unknown>;
  canary?: string;
}

export interface CopilotCase {
  id: string;
  country: EvalCountry;
  language: EvalLanguage;
  currency?: string;
  question: string;
  /** Each tool the person has, and what it returns. */
  tools: Record<string, unknown>;
  /** A draft tool to offer as well (it proposes; nothing is created). */
  draftTool?: string;
  canary?: string;
  expect: {
    tools: string[];
    mentions?: number[];
    noDraft?: boolean;
    draft?: string;
    noNumbers?: boolean;
    forbidden?: string[];
  };
}

export interface AnomalyNarrativeCase {
  id: string;
  country: EvalCountry;
  language: EvalLanguage;
  finding: { detector: string; category: string; severity: string; occurredOn: string; entityType: string; evidence: Record<string, unknown> };
}

export interface ReminderCase {
  id: string;
  country: EvalCountry;
  language: EvalLanguage;
  tone: 'cordial' | 'formal' | 'firm';
  facts: Record<string, string | number | null>;
}

export interface EvalSet<T> {
  feature: string;
  version: number;
  threshold: number;
  cases: T[];
}

export const BILL_CAPTURE_CASES = load('bill-capture.json') as EvalSet<BillCaptureCase>;
export const COPILOT_CASES = load('copilot.json') as EvalSet<CopilotCase>;
export const INJECTION_CASES = load('injection.json') as { feature: string; version: number; threshold: number; billCapture: BillCaptureCase[]; copilot: CopilotCase[] };
export const NARRATIVE_CASES = load('narratives.json') as { feature: string; version: number; threshold: number; anomalies: AnomalyNarrativeCase[]; reminders: ReminderCase[] };
