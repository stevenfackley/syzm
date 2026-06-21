/**
 * Decline-category recovery model — the single source of truth the marketing
 * ROI estimator and the /api/audit route both use. Category vocabulary matches
 * the Syzm Brain (`recovery_model.py`). Rates are industry-informed ESTIMATES,
 * not guarantees.
 */

export type DeclineCategory =
  | "insufficient_funds"
  | "do_not_honor"
  | "transient"
  | "velocity"
  | "expired_card"
  | "invalid_data"
  | "fraud"
  | "authentication"
  | "unknown";

export const DECLINE_CATEGORIES: DeclineCategory[] = [
  "insufficient_funds",
  "do_not_honor",
  "transient",
  "velocity",
  "expired_card",
  "invalid_data",
  "fraud",
  "authentication",
  "unknown",
];

export const CATEGORY_LABEL: Record<DeclineCategory, string> = {
  insufficient_funds: "Insufficient funds",
  do_not_honor: "Do not honor",
  transient: "Issuer transient / unavailable",
  velocity: "Velocity / limit exceeded",
  expired_card: "Expired card",
  invalid_data: "Invalid data",
  fraud: "Fraud / lost / stolen",
  authentication: "Authentication required",
  unknown: "Uncategorized",
};

/** Estimated share of failed-payment dollars recoverable via well-timed retries. */
export const RECOVERY_RATE: Record<DeclineCategory, number> = {
  insufficient_funds: 0.35,
  do_not_honor: 0.22,
  transient: 0.45,
  velocity: 0.3,
  expired_card: 0.15,
  invalid_data: 0.08,
  fraud: 0.0,
  authentication: 0.1,
  unknown: 0.15,
};

/** Categories Syzm will never retry (scheme rules + fraud risk). */
export const DO_NOT_RETRY: DeclineCategory[] = ["fraud"];

/** Default distribution of failed dollars across categories (industry-informed). Sums to 1. */
export const DEFAULT_MIX: Record<DeclineCategory, number> = {
  insufficient_funds: 0.32,
  do_not_honor: 0.19,
  transient: 0.12,
  velocity: 0.06,
  expired_card: 0.12,
  invalid_data: 0.05,
  fraud: 0.06,
  authentication: 0.04,
  unknown: 0.04,
};

export interface RecoverySegment {
  category: DeclineCategory;
  label: string;
  failedCents: number;
  rate: number;
  recoverableCents: number;
}

export interface RecoveryEstimate {
  failedCents: number;
  recoverableCents: number;
  blendedRate: number;
  band: { lowCents: number; highCents: number };
  segments: RecoverySegment[];
}

/** Map a raw processor decline code/string to a Syzm category. Best-effort. */
export function mapDeclineCode(raw: string): DeclineCategory {
  const c = raw.trim().toLowerCase();
  if (!c) return "unknown";
  if (/(insufficient|nsf|51|\b13\b)/.test(c)) return "insufficient_funds";
  if (/(do[_ ]?not[_ ]?honor|generic|05|do_not_honor)/.test(c)) return "do_not_honor";
  if (/(try[_ ]?again|issuer[_ ]?unavailable|processing[_ ]?error|reenter|91|96|server)/.test(c)) return "transient";
  if (/(velocity|limit|exceed|65|75|61)/.test(c)) return "velocity";
  if (/(expire|54)/.test(c)) return "expired_card";
  if (/(invalid|incorrect|14|15|format)/.test(c)) return "invalid_data";
  if (/(fraud|lost|stolen|pickup|pick[_ ]?up|41|43|07|57)/.test(c)) return "fraud";
  if (/(auth|3ds|sca|secure)/.test(c)) return "authentication";
  return "unknown";
}

export function blendedRate(mix: Record<DeclineCategory, number> = DEFAULT_MIX): number {
  return DECLINE_CATEGORIES.reduce((sum, c) => sum + mix[c] * RECOVERY_RATE[c], 0);
}

/**
 * Estimate recoverable revenue from total failed cents, split across categories
 * via `mix` (pass a real per-category breakdown for precision).
 */
export function estimateRecoverable(
  failedCents: number,
  mix: Record<DeclineCategory, number> = DEFAULT_MIX,
  bandFraction = 0.25,
): RecoveryEstimate {
  const safe = Number.isFinite(failedCents) && failedCents > 0 ? Math.trunc(failedCents) : 0;

  const segments: RecoverySegment[] = DECLINE_CATEGORIES.map((category) => {
    const failed = Math.round(safe * (mix[category] ?? 0));
    const rate = RECOVERY_RATE[category];
    return {
      category,
      label: CATEGORY_LABEL[category],
      failedCents: failed,
      rate,
      recoverableCents: Math.round(failed * rate),
    };
  }).filter((s) => s.failedCents > 0);

  const recoverableCents = segments.reduce((s, seg) => s + seg.recoverableCents, 0);
  const blended = safe > 0 ? recoverableCents / safe : 0;

  return {
    failedCents: safe,
    recoverableCents,
    blendedRate: blended,
    band: {
      lowCents: Math.round(recoverableCents * (1 - bandFraction)),
      highCents: Math.round(recoverableCents * (1 + bandFraction)),
    },
    segments,
  };
}

/** Build a normalized category mix from raw per-category failed-dollar totals. */
export function mixFromTotals(totals: Partial<Record<DeclineCategory, number>>): Record<DeclineCategory, number> {
  const sum = DECLINE_CATEGORIES.reduce((s, c) => s + (totals[c] ?? 0), 0);
  const mix = {} as Record<DeclineCategory, number>;
  for (const c of DECLINE_CATEGORIES) mix[c] = sum > 0 ? (totals[c] ?? 0) / sum : DEFAULT_MIX[c];
  return mix;
}
