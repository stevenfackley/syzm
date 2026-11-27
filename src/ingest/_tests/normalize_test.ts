/**
 * Tests for _shared/normalize.ts — webhook payload helpers used by webhook.ts.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { STRIPE_DECLINES } from "../_shared/declines.ts";
import { mapRawCodeToCategory, normalizeDecline, readAdyenDecline } from "../_shared/normalize.ts";
import { mapAdyenRefusalReason } from "../_shared/processors.ts";
import type { DeclineCategory } from "../_shared/types.ts";

function adyenNotification(item: Record<string, unknown>): Record<string, unknown> {
  return {
    live: "false",
    notificationItems: [{
      NotificationRequestItem: {
        pspReference: "PSP_0001",
        merchantAccountCode: "TestMerchant",
        merchantReference: "inv_adyen_42",
        amount: { value: 1999, currency: "USD" },
        eventCode: "AUTHORISATION",
        success: "false",
        reason: "Not enough balance",
        ...item,
      },
    }],
  };
}

Deno.test("Adyen: refused AUTHORISATION reads reason, amount and reference from the notification item", () => {
  const decline = readAdyenDecline(adyenNotification({}));

  assertEquals(decline.reason, "Not enough balance");
  assertEquals(decline.amountMinorUnits, 1999);
  assertEquals(decline.merchantReference, "inv_adyen_42");
});

Deno.test("Adyen: successful AUTHORISATION has no decline reason", () => {
  // On success Adyen puts the auth code and card summary in `reason`.
  const decline = readAdyenDecline(adyenNotification({ success: "true", reason: "065953:1111:03/2030" }));

  assertEquals(decline.reason, undefined);
});

Deno.test("Adyen: a failed non-authorisation event has no decline reason", () => {
  const decline = readAdyenDecline(
    adyenNotification({ eventCode: "REFUND_FAILED", reason: "Insufficient balance on payment" }),
  );

  assertEquals(decline.reason, undefined);
});

Deno.test("Adyen: body without notification items yields nothing", () => {
  assertEquals(readAdyenDecline({}), {});
  assertEquals(readAdyenDecline({ notificationItems: [] }), {});
});

Deno.test("Adyen: lower-cased webhook reasons map with the Adyen classifier", () => {
  // webhook.ts lower-cases the reason before classifying it.
  assertEquals(mapAdyenRefusalReason("not enough balance", ""), "insufficient_funds");
  assertEquals(mapAdyenRefusalReason("issuer unavailable", ""), "transient");
  assertEquals(mapAdyenRefusalReason("refused", ""), "unknown");
});

// ─── normalizeDecline ────────────────────────────────────────────────────────
// Characterization: these pin what the webhook normalizer does today, including
// the fallbacks, so a change to it shows up as a failing test.

Deno.test("normalizeDecline: Stripe invoice.payment_failed event", () => {
  const event = {
    id: "evt_1Abc",
    type: "invoice.payment_failed",
    data: {
      object: {
        invoice: "in_1Abc",
        amount_due: 1999,
        last_payment_error: { decline_code: "insufficient_funds", code: "card_declined" },
      },
    },
  };

  assertEquals(normalizeDecline("stripe", event, "corr-s"), {
    invoice_id: "in_1Abc",
    processor_event_id: "evt_1Abc",
    decline_code: "insufficient_funds",
    decline_category: "insufficient_funds",
    bank_bin: null,
    region: "US",
    retry_count: 0,
    original_amount_cents: 1999,
    processor_origin: "stripe",
    processor_history: ["stripe"],
    soft_decline: true,
  });
});

Deno.test("normalizeDecline: Adyen refused AUTHORISATION notification", () => {
  assertEquals(normalizeDecline("adyen", adyenNotification({}), "corr-a"), {
    invoice_id: "inv_adyen_42",
    processor_event_id: "PSP_0001",
    decline_code: "not enough balance",
    decline_category: "insufficient_funds",
    bank_bin: null,
    region: "US",
    retry_count: 0,
    original_amount_cents: 1999,
    processor_origin: "adyen",
    processor_history: ["adyen"],
    soft_decline: true,
  });
});

Deno.test("normalizeDecline: Braintree form body (parsed as {}) falls back everywhere", () => {
  // webhook.ts falls back to {} when the body is not JSON, which a Braintree
  // form-encoded notification never is.
  assertEquals(normalizeDecline("braintree", {}, "corr-b"), {
    invoice_id: "unknown_corr-b",
    processor_event_id: "braintree-unknown-corr-b",
    decline_code: null,
    decline_category: "unknown",
    bank_bin: null,
    region: "US",
    retry_count: 0,
    original_amount_cents: 0,
    processor_origin: "braintree",
    processor_history: ["braintree"],
    soft_decline: false,
  });
});

Deno.test("normalizeDecline: top-level fields win over the nested Stripe object", () => {
  const payload = {
    id: "evt_top",
    invoice_id: "inv_top",
    invoiceId: "inv_camel",
    decline_code: "Expired_Card",
    declineCode: "insufficient_funds",
    amount_cents: "1234.9",
    amount: 5,
    bank_bin: "4242424242",
    region: "GB",
    country: "FR",
    retry_count: "2",
    data: { object: { invoice: "in_nested", amount_due: 777, last_payment_error: { decline_code: "lost_card" } } },
  };

  const n = normalizeDecline("stripe", payload, "corr-t");

  assertEquals(n.invoice_id, "inv_top");
  assertEquals(n.decline_code, "expired_card"); // lower-cased
  assertEquals(n.decline_category, "expired_card");
  assertEquals(n.soft_decline, false);
  assertEquals(n.original_amount_cents, 1234); // truncated, not rounded
  assertEquals(n.bank_bin, "42424242"); // first 8 characters
  assertEquals(n.region, "GB");
  assertEquals(n.retry_count, 2);
});

Deno.test("normalizeDecline: camelCase and country fallbacks", () => {
  const n = normalizeDecline("stripe", {
    invoiceId: "inv_camel",
    declineCode: "ISSUER_UNAVAILABLE",
    amount: -50,
    bankBin: "555555",
    country: "CA",
  }, "corr-c");

  assertEquals(n.invoice_id, "inv_camel");
  assertEquals(n.decline_code, "issuer_unavailable");
  assertEquals(n.decline_category, "transient");
  assertEquals(n.soft_decline, true);
  assertEquals(n.original_amount_cents, 0); // negative clamps to 0
  assertEquals(n.bank_bin, "555555");
  assertEquals(n.region, "CA");
});

Deno.test("normalizeDecline: an amount that is not a number becomes 0", () => {
  const n = normalizeDecline("stripe", { decline_code: "insufficient_funds", amount_cents: "abc" }, "corr-n");

  assertEquals(n.original_amount_cents, 0);
  assertEquals(n.soft_decline, true);
});

Deno.test("normalizeDecline: top-level refusalReason is read for any processor", () => {
  const n = normalizeDecline("braintree", { refusalReason: "Insufficient funds" }, "corr-r");

  assertEquals(n.decline_code, "insufficient funds");
  assertEquals(n.decline_category, "insufficient_funds");
  assertEquals(n.soft_decline, true);
});

Deno.test("normalizeDecline: Adyen notification fields are read only for Adyen", () => {
  const n = normalizeDecline("stripe", adyenNotification({}), "corr-x");

  assertEquals(n.invoice_id, "unknown_corr-x");
  assertEquals(n.decline_code, null);
  assertEquals(n.original_amount_cents, 0);
  assertEquals(n.soft_decline, false);
});

Deno.test("normalizeDecline: Adyen successful AUTHORISATION is not a soft decline", () => {
  const n = normalizeDecline("adyen", adyenNotification({ success: "true", reason: "065953:1111:03/2030" }), "corr-ok");

  assertEquals(n.decline_code, null);
  assertEquals(n.decline_category, "unknown");
  assertEquals(n.soft_decline, false);
});

Deno.test("normalizeDecline: raw code 51 is soft even where its category is unknown", () => {
  // The soft-code set is checked before the category: an Adyen reason of "51"
  // classifies as unknown but is still queued.
  const n = normalizeDecline("adyen", adyenNotification({ reason: "51" }), "corr-51");

  assertEquals(n.decline_category, "unknown");
  assertEquals(n.soft_decline, true);
});

Deno.test("normalizeDecline: outside Stripe, soft categories are exactly the five the webhook queues", () => {
  // Stripe codes are queued by the shared decline table (stripe_declines_test.ts).
  // The keyword rules cannot produce invalid_data, so it is not listed.
  const cases: Array<[DeclineCategory, string, boolean]> = [
    ["insufficient_funds", "insufficient_funds", true],
    ["do_not_honor", "do_not_honor", true],
    ["transient", "issuer_unavailable", true],
    ["velocity", "card_velocity_exceeded", true],
    ["authentication_required", "authentication_required", true],
    ["expired_card", "expired_card", false],
    ["fraud", "fraudulent", false],
    ["lost_stolen", "lost_card", false],
    ["unknown", "generic_decline", false],
  ];

  for (const [category, code, soft] of cases) {
    const n = normalizeDecline("braintree", { decline_code: code }, "corr-soft");
    assertEquals(n.decline_category, category, code);
    assertEquals(n.soft_decline, soft, code);
  }
});

// ─── mapRawCodeToCategory (the webhook's classifier) ─────────────────────────

Deno.test("mapRawCodeToCategory: empty code is unknown for every processor", () => {
  assertEquals(mapRawCodeToCategory("stripe", ""), "unknown");
  assertEquals(mapRawCodeToCategory("adyen", ""), "unknown");
  assertEquals(mapRawCodeToCategory("braintree", ""), "unknown");
});

Deno.test("mapRawCodeToCategory: Adyen goes to the Adyen refusal classifier only", () => {
  // "51" and "issuer_unavailable" hit the generic rules for other processors,
  // but Adyen never reaches them.
  assertEquals(mapRawCodeToCategory("adyen", "51"), "unknown");
  assertEquals(mapRawCodeToCategory("adyen", "card blocked"), "fraud");
  assertEquals(mapRawCodeToCategory("adyen", "not enough balance"), "insufficient_funds");
});

const STRIPE_EXPLICIT: Array<[string, DeclineCategory]> = [
  ["lost_card", "lost_stolen"],
  ["stolen_card", "lost_stolen"],
  ["fraudulent", "fraud"],
  ["fraud", "fraud"],
  ["expired_card", "expired_card"],
  ["incorrect_number", "invalid_data"],
  ["invalid_number", "invalid_data"],
  ["insufficient_funds", "insufficient_funds"],
  ["issuer_not_available", "transient"],
  ["processing_error", "transient"],
  ["card_velocity_exceeded", "velocity"],
  ["authentication_required", "authentication_required"],
];

Deno.test("mapRawCodeToCategory: Stripe explicit codes", () => {
  for (const [code, category] of STRIPE_EXPLICIT) {
    assertEquals(mapRawCodeToCategory("stripe", code), category, code);
  }
});

Deno.test("mapRawCodeToCategory: Stripe-only codes are not special for Braintree", () => {
  // Braintree skips the Stripe block, so these go through the generic rules.
  assertEquals(mapRawCodeToCategory("braintree", "incorrect_number"), "unknown");
  assertEquals(mapRawCodeToCategory("braintree", "processing_error"), "unknown");
  assertEquals(mapRawCodeToCategory("braintree", "issuer_not_available"), "unknown");
  assertEquals(mapRawCodeToCategory("braintree", "lost_card"), "lost_stolen");
});

const GENERIC: Array<[string, DeclineCategory]> = [
  ["some_insufficient_balance", "insufficient_funds"],
  ["51", "insufficient_funds"],
  ["suspected_fraud", "fraud"],
  ["card_stolen", "lost_stolen"],
  ["card_lost", "lost_stolen"],
  ["card_expired", "expired_card"],
  ["do_not_honor", "do_not_honor"],
  ["do not honour", "do_not_honor"],
  ["do not honor", "unknown"], // only the British spelling has the spaced form
  ["velocity_hit", "velocity"],
  ["withdrawal_count_limit_exceeded", "velocity"],
  ["card_decline_rate_limit_exceeded", "velocity"],
  ["needs_authentication", "authentication_required"],
  ["issuer_unavailable", "transient"],
  ["generic_decline", "unknown"],
  ["card_declined", "unknown"],
  ["try_again_later", "unknown"],
  ["invalid_cvc", "unknown"],
  ["invalid_expiry_month", "unknown"],
  ["invalid_expiry_year", "unknown"],
  ["constructor", "unknown"],
];

Deno.test("mapRawCodeToCategory: generic rules for Braintree", () => {
  for (const [code, category] of GENERIC) {
    assertEquals(mapRawCodeToCategory("braintree", code), category, code);
  }
});

Deno.test("mapRawCodeToCategory: Stripe codes outside the decline table fall back to the generic rules", () => {
  for (const [code, category] of GENERIC) {
    if (STRIPE_DECLINES.has(code)) continue;
    assertEquals(mapRawCodeToCategory("stripe", code), category, code);
  }
});

Deno.test("mapRawCodeToCategory: generic rules apply in order", () => {
  // "insufficient" is checked before "limit", "fraud" before "lost".
  assertEquals(mapRawCodeToCategory("braintree", "insufficient_limit"), "insufficient_funds");
  assertEquals(mapRawCodeToCategory("braintree", "fraud_lost"), "fraud");
  assertEquals(mapRawCodeToCategory("braintree", "expired_limit"), "expired_card");
});
