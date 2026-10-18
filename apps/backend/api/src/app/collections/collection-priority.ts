/**
 * Who to chase first, and how. Pure: the service gathers the facts, this ranks them, so the
 * ranking can be read and tested as the rules it is.
 *
 * ## The score
 *
 *     priority = balance × (1 − p₃₀) × age weight × history factor
 *
 * - **balance** in the base currency: a large debt matters more than a small one.
 * - **p₃₀**, the chance it is collected within 30 days without anyone doing anything, from the
 *   cash-flow projection (how this customer actually pays). An invoice that will most likely arrive
 *   this week on its own is not where an hour of collections goes. With no projection, p₃₀ is a
 *   plain estimate from how overdue the invoice is.
 * - **age weight**: 1 at the due date, rising to 3 at 180 days overdue. Money gets harder to
 *   collect the longer it waits.
 * - **history**: each promise broken multiplies by 1.5; a promise still in date by 0.3 (someone
 *   said when they would pay, and that day has not come); a contact in the last three days by 0.5
 *   (chasing again tomorrow is noise, not collections).
 *
 * ## The suggested action
 *
 * A broken promise or more than 60 days overdue: call. 31–60: a firm reminder. 1–30: a reminder.
 * Not yet due but unlikely to arrive in a week: a courteous heads-up. A promise in date, or a
 * contact in the last three days: wait.
 */

export type CollectionAction = 'call' | 'firm_reminder' | 'reminder' | 'courtesy_reminder' | 'await_promise' | 'wait' | 'none';

/** The tone a reminder for each action is written in. */
export const TONE_FOR_ACTION: Partial<Record<CollectionAction, 'cordial' | 'formal' | 'firm'>> = {
  courtesy_reminder: 'cordial',
  reminder: 'formal',
  firm_reminder: 'firm',
  call: 'firm',
};

export interface CollectionFacts {
  balanceBase: number;
  daysOverdue: number;
  /** From the projection; null when there is none for this invoice. */
  pBy7: number | null;
  pBy30: number | null;
  doubtful: boolean;
  brokenPromises: number;
  /** A promise whose date has not passed yet. */
  openPromiseDate: string | null;
  /** Days since the last reminder, call or promise; null when there has been none. */
  daysSinceContact: number | null;
}

export interface CollectionRanking {
  priority: number;
  action: CollectionAction;
  /** p₃₀ actually used, and whether it came from the projection or the fallback. */
  pBy30: number;
  likelihoodSource: 'projection' | 'age';
  reasons: CollectionReason[];
}

export type CollectionReason =
  | 'large_balance'
  | 'unlikely_soon'
  | 'doubtful'
  | 'long_overdue'
  | 'broken_promise'
  | 'promise_in_date'
  | 'recently_contacted'
  | 'due_soon';

const RECENT_CONTACT_DAYS = 3;

/** p₃₀ from age alone, for when the projection has not run: the further past due, the lower. */
export function ageLikelihood(daysOverdue: number): number {
  if (daysOverdue > 90) return 0.2;
  if (daysOverdue > 60) return 0.35;
  if (daysOverdue > 30) return 0.5;
  if (daysOverdue > 0) return 0.65;
  return 0.8;
}

export function ageWeight(daysOverdue: number): number {
  return 1 + Math.min(Math.max(daysOverdue, 0), 180) / 90;
}

export function rankCollection(facts: CollectionFacts, largeBalance = Number.POSITIVE_INFINITY): CollectionRanking {
  const fromProjection = facts.pBy30 !== null && Number.isFinite(facts.pBy30);
  const p30 = clamp(fromProjection ? (facts.pBy30 as number) : ageLikelihood(facts.daysOverdue), 0, 1);
  const recentlyContacted = facts.daysSinceContact !== null && facts.daysSinceContact < RECENT_CONTACT_DAYS;

  let history = 1;
  if (facts.brokenPromises > 0) history *= 1.5 ** Math.min(facts.brokenPromises, 4);
  if (facts.openPromiseDate) history *= 0.3;
  if (recentlyContacted) history *= 0.5;

  const priority = Math.max(facts.balanceBase, 0) * (1 - p30) * ageWeight(facts.daysOverdue) * history;

  const reasons: CollectionReason[] = [];
  if (facts.balanceBase >= largeBalance) reasons.push('large_balance');
  if (p30 < 0.4) reasons.push('unlikely_soon');
  if (facts.doubtful) reasons.push('doubtful');
  if (facts.daysOverdue > 60) reasons.push('long_overdue');
  if (facts.brokenPromises > 0) reasons.push('broken_promise');
  if (facts.openPromiseDate) reasons.push('promise_in_date');
  if (recentlyContacted) reasons.push('recently_contacted');
  if (facts.daysOverdue <= 0 && facts.daysOverdue > -7) reasons.push('due_soon');

  return {
    priority: Math.round(priority * 100) / 100,
    action: suggestAction(facts, recentlyContacted),
    pBy30: Math.round(p30 * 10_000) / 10_000,
    likelihoodSource: fromProjection ? 'projection' : 'age',
    reasons,
  };
}

function suggestAction(facts: CollectionFacts, recentlyContacted: boolean): CollectionAction {
  if (facts.openPromiseDate) return 'await_promise';
  if (recentlyContacted) return 'wait';
  if (facts.brokenPromises > 0 || facts.daysOverdue > 60) return 'call';
  if (facts.daysOverdue > 30) return 'firm_reminder';
  if (facts.daysOverdue > 0) return 'reminder';
  const p7 = facts.pBy7 ?? (facts.daysOverdue > -7 ? 0.5 : 1);
  if (facts.daysOverdue > -7 && p7 < 0.5) return 'courtesy_reminder';
  return 'none';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
