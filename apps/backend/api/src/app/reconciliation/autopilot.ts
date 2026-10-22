/**
 * How sure the matcher may be before it confirms a match on its own, learned from what people did
 * with the matches it confirmed: kept, or undone.
 *
 * Each match confirmed without a person is recorded with its score. The threshold for an account
 * is the lowest score from which, historically, at most `MAX_UNDO_RATE` of those matches were
 * undone — never below what the company configured. When people undo more than `PAUSE_UNDO_RATE`
 * of them, confirming on its own stops for that account until a person resumes it.
 */
export const MAX_UNDO_RATE = 0.02;
export const PAUSE_UNDO_RATE = 0.05;
/** Outcomes needed before the history is believed over the configured threshold. */
export const MIN_SAMPLES_FOR_THRESHOLD = 10;
export const MIN_SAMPLES_FOR_PAUSE = 20;
/** How far back outcomes count. */
export const CALIBRATION_DAYS = 180;

export interface AutoOutcome {
  score: number;
  undone: boolean;
}

export interface Calibration {
  /** The score a match needs to be confirmed on its own, for this account. */
  minScore: number;
  /** Share of the automatic matches people kept; null without history. */
  precision: number | null;
  samples: number;
  /** Too many were undone: stop confirming on its own. */
  pause: boolean;
}

export function calibrate(outcomes: AutoOutcome[], configuredMin: number): Calibration {
  const samples = outcomes.length;
  if (!samples) return { minScore: configuredMin, precision: null, samples, pause: false };
  const undoneRate = outcomes.filter((outcome) => outcome.undone).length / samples;
  const pause = samples >= MIN_SAMPLES_FOR_PAUSE && undoneRate > PAUSE_UNDO_RATE;
  let minScore = configuredMin;
  if (samples >= MIN_SAMPLES_FOR_THRESHOLD) {
    minScore = 101;
    for (let score = configuredMin; score <= 100; score++) {
      const above = outcomes.filter((outcome) => outcome.score >= score);
      if (above.length < MIN_SAMPLES_FOR_THRESHOLD) break;
      if (above.filter((outcome) => outcome.undone).length / above.length <= MAX_UNDO_RATE) {
        minScore = score;
        break;
      }
    }
    // Nothing in the history is safe enough: only a perfect score, which is the strictest there is.
    if (minScore > 100) minScore = 100;
  }
  return { minScore, precision: 1 - undoneRate, samples, pause };
}
