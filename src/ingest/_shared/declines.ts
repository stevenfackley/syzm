/**
 * Stripe decline codes: the one classification the webhook (queue this
 * decline or not, normalize.ts) and the retry worker (try again or stop,
 * processors.ts and retry-worker.ts) both use.
 *
 * Sources, read 2026-11-27:
 *   [codes]  https://docs.stripe.com/declines/codes  (each code's description and next steps)
 *   [hard]   https://docs.stripe.com/billing/revenue-recovery/smart-retries#hard-decline-codes
 *            ("Stripe can't automatically retry a payment if the card issuer
 *            returns any of these hard decline codes")
 *   [advice] https://docs.stripe.com/declines/card  (advice codes: do_not_try_again,
 *            try_again_later, confirm_card_data)
 *   [errors] https://docs.stripe.com/error-codes  (card_declined and
 *            card_decline_rate_limit_exceeded are API error codes, not decline codes)
 *
 * Rule: terminal when Stripe lists the code as a hard decline, when its advice
 * is not to try again, or when the next step needs the customer to act on the
 * card (another card, corrected card data, authentication, or the card is
 * reported lost, stolen or fraudulent). Retryable when Stripe says to attempt
 * the payment again, when the decline is about funds or limits that recover
 * with time, and for the unexplained issuer declines Stripe does not list as
 * hard (do_not_honor and the like), which Stripe's own retries keep retrying.
 */

import type { DeclineCategory } from "./types.ts";

export type StripeDecline = { category: DeclineCategory; retryable: boolean };

const RETRY = true;
const STOP = false;

// [code, category, retryable]  // what Stripe says
const TABLE: ReadonlyArray<[string, DeclineCategory, boolean]> = [
  // ── Retryable ────────────────────────────────────────────────────────────
  ["insufficient_funds", "insufficient_funds", RETRY], // funds; not a hard decline
  ["withdrawal_count_limit_exceeded", "velocity", RETRY], // balance or credit limit exceeded
  ["card_velocity_exceeded", "velocity", RETRY], // balance, credit or amount limit exceeded
  ["card_decline_rate_limit_exceeded", "velocity", RETRY], // [errors] try again after 24 hours
  ["issuer_not_available", "transient", RETRY], // "Attempt the payment again"
  ["processing_error", "transient", RETRY], // "attempt the payment again"
  ["reenter_transaction", "transient", RETRY], // "needs to be attempted again"
  ["approve_with_id", "transient", RETRY], // "Attempt the payment again"
  ["try_again_later", "transient", RETRY], // deprecated; "attempt the payment again"
  ["do_not_honor", "do_not_honor", RETRY], // unknown reason; not a hard decline
  ["generic_decline", "do_not_honor", RETRY], // unknown reason; not a hard decline
  ["card_declined", "do_not_honor", RETRY], // [errors] declined, reason not given
  ["call_issuer", "do_not_honor", RETRY], // unknown reason; not a hard decline
  ["no_action_taken", "do_not_honor", RETRY], // unknown reason; not a hard decline
  ["security_violation", "do_not_honor", RETRY], // unknown reason; not a hard decline

  // ── Terminal: lost, stolen, fraud ────────────────────────────────────────
  ["lost_card", "lost_stolen", STOP], // [hard]
  ["stolen_card", "lost_stolen", STOP], // [hard]
  ["pickup_card", "lost_stolen", STOP], // [hard]; possibly reported lost or stolen
  ["restricted_card", "lost_stolen", STOP], // possibly reported lost or stolen
  ["fraudulent", "fraud", STOP], // Stripe suspects fraud
  ["fraud", "fraud", STOP], // not a Stripe code; kept from the previous table
  ["merchant_blacklist", "fraud", STOP], // matches the account's block list
  ["highest_risk_level", "fraud", STOP], // [hard]

  // ── Terminal: the issuer or the cardholder withdrew the authorization ────
  ["revocation_of_authorization", "do_not_honor", STOP], // [hard]
  ["revocation_of_all_authorizations", "do_not_honor", STOP], // [hard]
  ["transaction_not_allowed", "do_not_honor", STOP], // [hard]
  ["not_permitted", "do_not_honor", STOP], // "The payment isn't permitted"; as transaction_not_allowed
  ["service_not_allowed", "do_not_honor", STOP], // as transaction_not_allowed
  ["stop_payment_order", "do_not_honor", STOP], // cardholder stopped payments; as revocation_of_authorization
  ["do_not_try_again", "do_not_honor", STOP], // deprecated; [advice] "shouldn't use it again"

  // ── Terminal: the customer has to use another card or fix its data ───────
  ["expired_card", "expired_card", STOP], // "use another card"
  ["incorrect_number", "invalid_data", STOP], // [hard]
  ["invalid_number", "invalid_data", STOP], // correct card number needed
  ["incorrect_cvc", "invalid_data", STOP], // correct CVC needed
  ["invalid_cvc", "invalid_data", STOP], // correct CVC needed
  ["invalid_expiry_month", "invalid_data", STOP], // correct expiration date needed
  ["invalid_expiry_year", "invalid_data", STOP], // correct expiration date needed
  ["incorrect_zip", "invalid_data", STOP], // correct postal code needed
  ["incorrect_address", "invalid_data", STOP], // correct address needed
  ["incorrect_pin", "invalid_data", STOP], // correct PIN needed
  ["invalid_pin", "invalid_data", STOP], // correct PIN needed
  ["pin_try_exceeded", "invalid_data", STOP], // "must use another card"
  ["invalid_account", "invalid_data", STOP], // card or account invalid
  ["new_account_information_available", "invalid_data", STOP], // card or account invalid
  ["card_not_supported", "invalid_data", STOP], // card can't be used for this purchase
  ["currency_not_supported", "invalid_data", STOP], // card can't be used in this currency
  ["invalid_amount", "invalid_data", STOP], // amount invalid or over what the card allows
  ["testmode_decline", "invalid_data", STOP], // a test card; a genuine card is needed
  // "Check to see if a recent payment already exists": a repeat could charge twice.
  ["duplicate_transaction", "invalid_data", STOP],

  // ── Terminal: the customer has to authenticate ───────────────────────────
  ["authentication_required", "authentication_required", STOP], // [hard]
  ["authentication_not_handled", "authentication_required", STOP], // run 3DS / SCA on-session
  ["mobile_device_authentication_required", "authentication_required", STOP], // customer taps again
  ["offline_pin_required", "authentication_required", STOP], // customer inserts card and enters PIN
  ["online_or_offline_pin_required", "authentication_required", STOP], // customer enters PIN
];

export const STRIPE_DECLINES: ReadonlyMap<string, StripeDecline> = new Map(
  TABLE.map(([code, category, retryable]) => [code, { category, retryable }]),
);

/** Categories that are never retried when a code is not in the table. */
const TERMINAL_CATEGORIES: ReadonlySet<DeclineCategory> = new Set<DeclineCategory>([
  "fraud",
  "lost_stolen",
  "expired_card",
  "invalid_data",
  "authentication_required",
]);

/**
 * A Stripe decline code (case-insensitive). A code not in the table is
 * classified by keywords; one that matches none is "unknown" and retryable,
 * as Stripe retries every decline it does not list as hard.
 */
export function classifyStripeDecline(code: string): StripeDecline {
  const lowered = code.toLowerCase();
  const listed = STRIPE_DECLINES.get(lowered);
  if (listed) return listed;
  const category = classifyByKeywords(lowered);
  return { category, retryable: !TERMINAL_CATEGORIES.has(category) };
}

/** Best-effort classification of a lower-cased code from any processor. */
export function classifyByKeywords(rawCode: string): DeclineCategory {
  if (!rawCode) return "unknown";
  if (rawCode.includes("insufficient") || rawCode === "51") return "insufficient_funds";
  if (rawCode.includes("fraud")) return "fraud";
  if (rawCode.includes("stolen") || rawCode.includes("lost")) return "lost_stolen";
  if (rawCode.includes("expired")) return "expired_card";
  if (rawCode.includes("do_not_honor") || rawCode.includes("do not honour")) return "do_not_honor";
  if (rawCode.includes("velocity") || rawCode.includes("limit")) return "velocity";
  if (rawCode.includes("authentication")) return "authentication_required";
  if (rawCode === "issuer_unavailable") return "transient";
  return "unknown";
}
