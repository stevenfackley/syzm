/**
 * Stripe decline codes have one classification (_shared/declines.ts), used by
 * the webhook when a decline is ingested (normalizeDecline: queue it or not)
 * and by the retry worker when a retry is declined (retryPayment, then
 * afterDecline: try again or stop). The parity test below sends every code
 * through both real paths and fails if they ever disagree, on the category or
 * on whether the decline is retried.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { STRIPE_DECLINES } from "../_shared/declines.ts";
import { normalizeDecline } from "../_shared/normalize.ts";
import { type ProcessorCredentials, retryPayment, type RetryResult } from "../_shared/processors.ts";
import { afterDecline } from "../_shared/retry-worker.ts";
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

/** The webhook path: a Stripe payment_failed event carrying this decline code. */
function webhook(code: string): { category: DeclineCategory; retried: boolean } {
  const event = {
    id: "evt_decl",
    type: "payment_intent.payment_failed",
    data: { object: { invoice: "in_decl", amount_due: 1999, last_payment_error: { decline_code: code } } },
  };
  const n = normalizeDecline("stripe", event, "corr-decl");
  return { category: n.decline_category, retried: n.soft_decline };
}

/** The worker path: Stripe declines the first retry with this code. */
async function worker(code: string): Promise<{ category: DeclineCategory; retried: boolean; result: RetryResult }> {
  const result = await retryPayment("stripe", attempt, creds, "corr-decl", stripeError({ decline_code: code }));
  assertEquals(result.ok, false);
  assertEquals(result.rawDeclineCode, code);
  return { category: result.declineCategory, retried: afterDecline(result, 1) === "rescheduled", result };
}

// Codes outside the table: case variants, codes the keyword fallback catches,
// codes nothing knows, and object-prototype names.
const PROBES = [
  "GENERIC_DECLINE",
  "Insufficient_Funds",
  "51",
  "issuer_unavailable",
  "some_new_limit_code",
  "some_new_fraud_code",
  "some_lost_card_variant",
  "some_new_code",
  "constructor",
  "__proto__",
];

Deno.test("Stripe declines: the webhook and the worker agree on every code", async () => {
  for (const code of [...STRIPE_DECLINES.keys(), ...PROBES]) {
    const w = await worker(code);
    const h = webhook(code);
    assertEquals(h.category, w.category, `${code}: category`);
    assertEquals(h.retried, w.retried, `${code}: webhook queues it = worker retries it`);
  }
});

Deno.test("Stripe declines: the table decides what both paths do", async () => {
  for (const [code, expected] of STRIPE_DECLINES) {
    const w = await worker(code);
    assertEquals({ category: w.category, retried: w.retried }, { category: expected.category, retried: expected.retryable }, code);
  }
});

// The owner's decision of 2026-11-26 names these. Pinned so a change to the
// table is a visible change to this list.
const DECIDED: Array<[string, DeclineCategory, boolean]> = [
  // The seven codes the worker retried and the webhook classified differently.
  ["generic_decline", "do_not_honor", true],
  ["card_declined", "do_not_honor", true],
  ["try_again_later", "transient", true],
  ["card_decline_rate_limit_exceeded", "velocity", true],
  ["invalid_cvc", "invalid_data", false],
  ["invalid_expiry_month", "invalid_data", false],
  ["invalid_expiry_year", "invalid_data", false],
  // Terminal because the customer has to act.
  ["lost_card", "lost_stolen", false],
  ["stolen_card", "lost_stolen", false],
  ["pickup_card", "lost_stolen", false],
  ["fraudulent", "fraud", false],
  ["invalid_account", "invalid_data", false],
];

for (const [code, category, retryable] of DECIDED) {
  Deno.test(`Stripe decline "${code}": ${category}, ${retryable ? "retried" : "not retried"} by both paths`, async () => {
    assertEquals(STRIPE_DECLINES.get(code), { category, retryable });
    const w = await worker(code);
    assertEquals([w.category, w.retried], [category, retryable]);
    assertEquals(webhook(code), { category, retried: retryable });
  });
}

Deno.test("Stripe declines: table codes are lower-case, so the case-insensitive lookup reaches every row", () => {
  for (const code of STRIPE_DECLINES.keys()) assertEquals(code, code.toLowerCase());
});

Deno.test("Stripe declines: a code nothing knows is retried by both, as Stripe retries every non-hard decline", async () => {
  assertEquals((await worker("some_new_code")).retried, true);
  assertEquals(webhook("some_new_code"), { category: "unknown", retried: true });
});

Deno.test("Stripe declines: a payload without a decline code is not queued", () => {
  const n = normalizeDecline("stripe", { id: "evt_none", data: { object: { invoice: "in_none" } } }, "corr-none");
  assertEquals([n.decline_code, n.decline_category, n.soft_decline], [null, "unknown", false]);
});

Deno.test("Stripe declines: the worker falls back to error.code, then to unknown", async () => {
  const byCode = await retryPayment("stripe", attempt, creds, "c1", stripeError({ code: "card_declined" }));
  assertEquals([byCode.declineCategory, byCode.rawDeclineCode, byCode.retryable], ["do_not_honor", "card_declined", true]);

  const empty = await retryPayment("stripe", attempt, creds, "c2", stripeError(undefined));
  assertEquals([empty.declineCategory, empty.rawDeclineCode, empty.retryable], ["unknown", "unknown", true]);
});

Deno.test("Stripe declines: a PaymentIntent that needs the customer is not retried", async () => {
  for (const status of ["requires_action", "requires_payment_method"]) {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ id: "pi_1", status }), { status: 200 })) as typeof fetch;
    const result = await retryPayment("stripe", attempt, creds, "c3", fetchImpl);
    assertEquals([result.declineCategory, afterDecline(result, 1)], ["authentication_required", "blocked"]);
  }
});
