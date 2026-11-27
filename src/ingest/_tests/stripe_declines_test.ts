/**
 * Stripe decline codes are classified twice: by the retry worker when a retry
 * is declined (processors.ts, through retryPayment) and by the webhook when a
 * decline is ingested (normalize.ts mapRawCodeToCategory, which decides whether
 * the decline is queued at all). This table pins both answers for every code
 * either side lists, side by side. Rows marked DISAGREE are known drift that is
 * left for an owner decision; they are pinned so a change to either side shows.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapRawCodeToCategory } from "../_shared/normalize.ts";
import {
  type ProcessorCredentials,
  retryPayment,
  STRIPE_DECLINE_CATEGORIES,
} from "../_shared/processors.ts";
import type { DeclineCategory } from "../_shared/types.ts";

const creds: ProcessorCredentials = {
  stripeApiKey: "sk_test_1234",
  adyenApiKey: "adyen_test_key",
  adyenMerchantAccount: "TestMerchant",
  braintreePublicKey: "pub",
  braintreePrivateKey: "priv",
  braintreeMerchantId: "merchant1",
};

const attempt = {
  invoiceId: "inv_decl",
  amountCents: 1999,
  paymentToken: "pm_test|cu_test",
  idempotencyKey: "syzm-row-attempt-1",
};

function stripeError(error: Record<string, unknown> | undefined): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(error === undefined ? {} : { error }), {
      status: 402,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

/** What the retry worker records for a Stripe decline carrying this decline_code. */
async function workerCategory(code: string): Promise<DeclineCategory> {
  const result = await retryPayment("stripe", attempt, creds, "corr-decl", stripeError({ decline_code: code }));
  assertEquals(result.ok, false);
  assertEquals(result.rawDeclineCode, code);
  return result.declineCategory;
}

// [code, retry worker, webhook]
const TABLE: Array<[string, DeclineCategory, DeclineCategory]> = [
  ["insufficient_funds", "insufficient_funds", "insufficient_funds"],
  ["do_not_honor", "do_not_honor", "do_not_honor"],
  ["lost_card", "lost_stolen", "lost_stolen"],
  ["stolen_card", "lost_stolen", "lost_stolen"],
  ["fraudulent", "fraud", "fraud"],
  ["fraud", "fraud", "fraud"],
  ["expired_card", "expired_card", "expired_card"],
  ["incorrect_number", "invalid_data", "invalid_data"],
  ["invalid_number", "invalid_data", "invalid_data"],
  ["issuer_not_available", "transient", "transient"],
  ["processing_error", "transient", "transient"],
  ["card_velocity_exceeded", "velocity", "velocity"],
  ["withdrawal_count_limit_exceeded", "velocity", "velocity"],
  ["authentication_required", "authentication_required", "authentication_required"],
  // DISAGREE: codes only the worker lists; the webhook's substring rules answer differently.
  ["card_decline_rate_limit_exceeded", "insufficient_funds", "velocity"],
  ["generic_decline", "do_not_honor", "unknown"],
  ["card_declined", "do_not_honor", "unknown"],
  ["invalid_expiry_month", "invalid_data", "unknown"],
  ["invalid_expiry_year", "invalid_data", "unknown"],
  ["invalid_cvc", "invalid_data", "unknown"],
  ["try_again_later", "transient", "unknown"],
  // DISAGREE: codes neither lists; only the webhook's substring rules classify them.
  ["issuer_unavailable", "unknown", "transient"],
  ["51", "unknown", "insufficient_funds"],
  ["some_new_limit_code", "unknown", "velocity"],
  // Agree: unknown to both.
  ["approve_with_id", "unknown", "unknown"],
  ["constructor", "unknown", "unknown"],
  ["__proto__", "unknown", "unknown"],
  ["", "unknown", "unknown"],
];

for (const [code, worker, webhook] of TABLE) {
  Deno.test(`Stripe decline "${code}": worker ${worker}, webhook ${webhook}`, async () => {
    assertEquals(await workerCategory(code), worker);
    assertEquals(mapRawCodeToCategory("stripe", code), webhook);
  });
}

Deno.test("Stripe decline: every shared code gets the shared answer on both sides", async () => {
  const pinned = new Set(TABLE.map(([code]) => code));
  for (const [code, category] of STRIPE_DECLINE_CATEGORIES) {
    assertEquals(pinned.has(code), true, `${code} is missing from TABLE above`);
    assertEquals(await workerCategory(code), category, code);
    assertEquals(mapRawCodeToCategory("stripe", code), category, code);
  }
});

Deno.test("Stripe decline: the worker matches codes case-sensitively", async () => {
  // The webhook lower-cases before classifying (normalizeDecline); the worker does not.
  assertEquals(await workerCategory("Insufficient_Funds"), "unknown");
  assertEquals(await workerCategory("GENERIC_DECLINE"), "unknown");
});

Deno.test("Stripe decline: the worker falls back to error.code, then to unknown", async () => {
  const byCode = await retryPayment("stripe", attempt, creds, "c1", stripeError({ code: "card_declined" }));
  assertEquals(byCode.declineCategory, "do_not_honor");
  assertEquals(byCode.rawDeclineCode, "card_declined");

  const empty = await retryPayment("stripe", attempt, creds, "c2", stripeError(undefined));
  assertEquals(empty.declineCategory, "unknown");
  assertEquals(empty.rawDeclineCode, "unknown");
});
