/**
 * Centralized retry eligibility guards.
 * All rules that determine whether a retry should proceed live here.
 */

import type { DeclineCategory, ProcessorName } from "./types.ts";
import { NO_RETRY_CATEGORIES } from "./types.ts";

export type GuardViolation =
  | { reason: "fraud_or_stolen"; category: DeclineCategory }
  | { reason: "max_retries_exceeded"; retry_count: number }
  | { reason: "bank_blackout_window"; utc_hour: number; utc_day: number };

export type GuardResult =
  | { allowed: true }
  | { allowed: false; violation: GuardViolation };

/**
 * Visa/network cap: no more than 4 total attempts (retry_count is the number of
 * retries ALREADY attempted; we'd be making attempt #retry_count+1).
 */
const VISA_MAX_RETRIES = 4;

/**
 * Sunday 01:00–03:00 ET US bank processing blackout.
 * ET is UTC-5 (EST) or UTC-4 (EDT). We conservatively block UTC 05:00–08:00
 * Sunday to cover both offsets with a buffer.
 */
const BLACKOUT_UTC_DAY = 0; // Sunday (getUTCDay)
const BLACKOUT_UTC_START = 5; // 05:00 UTC (01:00 ET)
const BLACKOUT_UTC_END = 8; // 08:00 UTC (03:00 ET + buffer)

/**
 * Check all retry guards. Returns { allowed: true } if safe to proceed,
 * or { allowed: false, violation } with the first failing rule.
 */
export function checkRetryGuards(
  declineCategory: DeclineCategory,
  retryCount: number,
  now: Date = new Date(),
): GuardResult {
  if (NO_RETRY_CATEGORIES.has(declineCategory)) {
    return {
      allowed: false,
      violation: { reason: "fraud_or_stolen", category: declineCategory },
    };
  }

  if (retryCount >= VISA_MAX_RETRIES) {
    return {
      allowed: false,
      violation: { reason: "max_retries_exceeded", retry_count: retryCount },
    };
  }

  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();
  if (
    utcDay === BLACKOUT_UTC_DAY &&
    utcHour >= BLACKOUT_UTC_START &&
    utcHour < BLACKOUT_UTC_END
  ) {
    return {
      allowed: false,
      violation: { reason: "bank_blackout_window", utc_hour: utcHour, utc_day: utcDay },
    };
  }

  return { allowed: true };
}

/**
 * Log a guard violation with correlation context and return a human-readable
 * reason string for storage.
 */
export function describeViolation(
  violation: GuardViolation,
  correlationId: string,
): string {
  switch (violation.reason) {
    case "fraud_or_stolen":
      console.warn(
        JSON.stringify({
          event: "retry_guard_blocked",
          reason: violation.reason,
          category: violation.category,
          correlation_id: correlationId,
        }),
      );
      return `blocked:${violation.reason}:${violation.category}`;
    case "max_retries_exceeded":
      console.warn(
        JSON.stringify({
          event: "retry_guard_blocked",
          reason: violation.reason,
          retry_count: violation.retry_count,
          correlation_id: correlationId,
        }),
      );
      return `blocked:${violation.reason}:count=${violation.retry_count}`;
    case "bank_blackout_window":
      console.warn(
        JSON.stringify({
          event: "retry_guard_blocked",
          reason: violation.reason,
          utc_day: violation.utc_day,
          utc_hour: violation.utc_hour,
          correlation_id: correlationId,
        }),
      );
      return `blocked:${violation.reason}`;
  }
}

// Re-export for convenience so callers only need to import from guards.ts
export { NO_RETRY_CATEGORIES };
export type { DeclineCategory, ProcessorName };
