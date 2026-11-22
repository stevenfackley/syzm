export type ProcessorName = "stripe" | "adyen" | "braintree";

/**
 * Shared decline-category vocabulary across all processors.
 * "fraud" and "lost_stolen" are never retried.
 */
export type DeclineCategory =
  | "insufficient_funds"
  | "do_not_honor"
  | "transient"
  | "velocity"
  | "expired_card"
  | "invalid_data"
  | "fraud"
  | "lost_stolen"
  | "authentication_required"
  | "unknown";

/** Categories for which retrying is never appropriate. */
export const NO_RETRY_CATEGORIES: ReadonlySet<DeclineCategory> = new Set([
  "fraud",
  "lost_stolen",
]);

export type NormalizedDecline = {
  invoice_id: string;
  processor_event_id: string;
  decline_code: string | null;
  decline_category: DeclineCategory;
  bank_bin: string | null;
  region: string;
  retry_count: number;
  original_amount_cents: number;
  processor_origin: ProcessorName;
  processor_history: ProcessorName[];
  soft_decline: boolean;
};

/**
 * Mirrors the Brain's ScheduleRequest (src/brain/app/schemas.py and
 * src/shared/openapi/syzm-brain.yaml). bank_bin is left out: the Brain does not
 * score on it and rejects a value that is not all digits.
 */
export type BrainScheduleRequest = {
  invoice_id: string;
  decline_code: string | null;
  region: string;
  retry_count: number;
  original_amount_cents: number;
  processor_origin: ProcessorName;
  processor_history: ProcessorName[];
};

export type BrainScheduleResponse = {
  invoice_id: string;
  scheduled_at_utc: string;
  reason: string;
  strategy_version: string;
  eligible_processors: ProcessorName[];
};

