import { DuplicateRecord } from '../../contracts/data-quality/duplicate-sources.contract';

/**
 * Which records are probably the same thing, and why. Pure, so the rules can be read and tested.
 *
 * ## Blocking, then scoring
 *
 * Comparing every record with every other is n² — a million pairs for a thousand customers.
 * Instead records are grouped by what duplicates share: the same tax id, e-mail, phone, code or
 * barcode, or a distinctive word of the name (one that few records use: «Comercial» joins half the
 * book and proves nothing). Only records that share a group are compared, and a group too large to
 * mean anything is skipped.
 *
 * ## The score
 *
 * - The same tax id or the same barcode is all but conclusive (0.98).
 * - Otherwise the names' trigram similarity carries it, raised by the same e-mail, phone or code.
 * - Two different tax ids are two different taxpayers, however alike the names: the score drops.
 *
 * Names are compared without accents, punctuation or legal suffixes (SRL, S.A., EIRL, Inc…), so
 * «Distribuidora Peña, S.R.L.» and «DISTRIBUIDORA PENA SRL» are the same name.
 */

export type DuplicateReason = 'same_tax_id' | 'same_barcode' | 'same_email' | 'same_phone' | 'same_code' | 'similar_name' | 'different_tax_id';

export interface DuplicatePair {
  a: DuplicateRecord;
  b: DuplicateRecord;
  score: number;
  reasons: DuplicateReason[];
}

export const MIN_SCORE = 0.8;
/** A group larger than this says nothing about its members. */
const MAX_BLOCK = 60;

const LEGAL_SUFFIXES = new Set(['srl', 'sa', 'sas', 'saa', 'eirl', 'inc', 'llc', 'ltd', 'ltda', 'cxa', 'corp', 'co', 'cia', 'sl', 'sau', 'spa', 'gmbh', 'de', 'cv', 'rl', 'por', 'c']);

export function normaliseName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // «S.R.L.» is one word, not three letters.
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word && !LEGAL_SUFFIXES.has(word))
    .join(' ');
}

export const normaliseTaxId = (value: string | null | undefined) => (value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '') || null;
export const normaliseEmail = (value: string | null | undefined) => (value ?? '').trim().toLowerCase() || null;
export const normaliseCode = (value: string | null | undefined) => (value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '') || null;
/** The last 8 digits: country code and leading zeros vary, the subscriber number does not. */
export function normalisePhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-8) : null;
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Jaccard similarity of the two names' trigrams, 0–1 (what PostgreSQL's pg_trgm computes). */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const gram of ta) if (tb.has(gram)) shared++;
  return shared / (ta.size + tb.size - shared);
}

interface Prepared {
  record: DuplicateRecord;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  code: string | null;
  barcode: string | null;
}

export function scorePair(x: Prepared, y: Prepared): { score: number; reasons: DuplicateReason[] } {
  const reasons: DuplicateReason[] = [];
  if (x.taxId && y.taxId && x.taxId === y.taxId) reasons.push('same_tax_id');
  if (x.barcode && y.barcode && x.barcode === y.barcode) reasons.push('same_barcode');
  if (x.email && y.email && x.email === y.email) reasons.push('same_email');
  if (x.phone && y.phone && x.phone === y.phone) reasons.push('same_phone');
  if (x.code && y.code && x.code === y.code) reasons.push('same_code');
  const similarity = nameSimilarity(x.name, y.name);
  if (similarity >= 0.6) reasons.push('similar_name');

  let score: number;
  if (reasons.includes('same_tax_id') || reasons.includes('same_barcode')) {
    score = 0.98;
  } else {
    score = similarity * 0.75;
    if (reasons.includes('same_email')) score += 0.2;
    if (reasons.includes('same_phone')) score += 0.15;
    if (reasons.includes('same_code')) score += 0.25;
    score = Math.min(score, 0.97);
  }
  if (x.taxId && y.taxId && x.taxId !== y.taxId) {
    reasons.push('different_tax_id');
    score *= 0.3;
  }
  return { score: Math.round(score * 10_000) / 10_000, reasons };
}

export function findDuplicates(records: DuplicateRecord[], minScore = MIN_SCORE): DuplicatePair[] {
  const prepared: Prepared[] = records.map((record) => ({
    record,
    name: normaliseName(record.name),
    taxId: normaliseTaxId(record.taxId),
    email: normaliseEmail(record.email),
    phone: normalisePhone(record.phone),
    code: normaliseCode(record.code),
    barcode: normaliseCode(record.barcode),
  }));

  // How many names use each word: a word in many names cannot tell them apart.
  const frequency = new Map<string, number>();
  for (const item of prepared) {
    for (const word of new Set(item.name.split(' '))) if (word.length >= 3) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }

  const blocks = new Map<string, number[]>();
  const add = (key: string | null, index: number) => {
    if (!key) return;
    const list = blocks.get(key) ?? [];
    list.push(index);
    blocks.set(key, list);
  };
  prepared.forEach((item, index) => {
    add(item.taxId && `t:${item.taxId}`, index);
    add(item.email && `e:${item.email}`, index);
    add(item.phone && `p:${item.phone}`, index);
    add(item.code && `c:${item.code}`, index);
    add(item.barcode && `b:${item.barcode}`, index);
    // The two most distinctive words of the name.
    const words = [...new Set(item.name.split(' '))]
      .filter((word) => word.length >= 3)
      .sort((u, v) => (frequency.get(u) ?? 0) - (frequency.get(v) ?? 0))
      .slice(0, 2);
    for (const word of words) add(`n:${word}`, index);
    if (!words.length && item.name) add(`n:${item.name}`, index);
  });

  const seen = new Set<string>();
  const pairs: DuplicatePair[] = [];
  for (const members of blocks.values()) {
    if (members.length < 2 || members.length > MAX_BLOCK) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const x = prepared[members[i]];
        const y = prepared[members[j]];
        const [first, second] = x.record.id < y.record.id ? [x, y] : [y, x];
        const key = `${first.record.id}|${second.record.id}`;
        if (seen.has(key) || first.record.id === second.record.id) continue;
        seen.add(key);
        const { score, reasons } = scorePair(first, second);
        if (score >= minScore) pairs.push({ a: first.record, b: second.record, score, reasons });
      }
    }
  }
  return pairs.sort((p, q) => q.score - p.score);
}
