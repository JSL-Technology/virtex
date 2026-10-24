import { descriptionWords } from './reconciliation.service';

/**
 * Which account a bank line belongs to, learned from how this company booked the same kind of
 * line before: a multinomial naive Bayes over the words of the bank's description (amounts and
 * numbers removed), plus the direction of the money as a token of its own.
 *
 * Classical on purpose. The training set is this company's own history — tens to thousands of
 * lines — and the labels are its own accounts: a model that counts words is fast, explainable
 * ("CLARO" and "debit" pointed to telephone expense), needs no provider and sends nothing out.
 */
export interface BankLineSample {
  description: string;
  /** Positive when money came in. */
  amount: number;
  label: string;
}

export interface BankLineModel {
  labels: Map<string, { docs: number; tokens: number; counts: Map<string, number> }>;
  vocabulary: Set<string>;
  docs: number;
}

export interface BankLinePrediction {
  label: string;
  probability: number;
  /** How many past lines carried this label. */
  support: number;
  /** The words that weighed most for it. */
  evidence: string[];
}

export function tokens(description: string, amount: number): string[] {
  return [...descriptionWords(description), amount >= 0 ? '__in' : '__out'];
}

export function trainBankLineModel(samples: BankLineSample[]): BankLineModel {
  const model: BankLineModel = { labels: new Map(), vocabulary: new Set(), docs: 0 };
  for (const sample of samples) {
    const words = tokens(sample.description, sample.amount);
    if (words.length < 2) continue;
    let entry = model.labels.get(sample.label);
    if (!entry) {
      entry = { docs: 0, tokens: 0, counts: new Map() };
      model.labels.set(sample.label, entry);
    }
    entry.docs += 1;
    model.docs += 1;
    for (const word of words) {
      entry.tokens += 1;
      entry.counts.set(word, (entry.counts.get(word) ?? 0) + 1);
      model.vocabulary.add(word);
    }
  }
  return model;
}

/** The most likely labels, best first, with probabilities that add up to one. */
export function predictBankLine(model: BankLineModel, description: string, amount: number, top = 3): BankLinePrediction[] {
  if (!model.docs) return [];
  const words = tokens(description, amount).filter((word) => model.vocabulary.has(word));
  // Only the direction known: nothing in the description was ever seen, nothing to say.
  if (words.filter((word) => !word.startsWith('__')).length === 0) return [];
  const size = model.vocabulary.size;
  const scores: Array<{ label: string; log: number; support: number; evidence: Array<[string, number]> }> = [];
  for (const [label, entry] of model.labels) {
    let log = Math.log(entry.docs / model.docs);
    const evidence: Array<[string, number]> = [];
    for (const word of words) {
      const weight = Math.log(((entry.counts.get(word) ?? 0) + 1) / (entry.tokens + size));
      log += weight;
      if (entry.counts.has(word) && !word.startsWith('__')) evidence.push([word, entry.counts.get(word)!]);
    }
    scores.push({ label, log, support: entry.docs, evidence });
  }
  const best = Math.max(...scores.map((score) => score.log));
  const total = scores.reduce((sum, score) => sum + Math.exp(score.log - best), 0);
  return scores
    .map((score) => ({
      label: score.label,
      probability: Math.exp(score.log - best) / total,
      support: score.support,
      evidence: score.evidence.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word]) => word),
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, top);
}
