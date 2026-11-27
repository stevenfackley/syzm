/**
 * Tests for idempotency behavior.
 *
 * The webhook normalizer extracts a consistent processor_event_id for each
 * processor so duplicate events produce the same key. What the database does
 * with a duplicate (the insert fails on a unique index and the webhook drops
 * it) is covered against the real migrations in pipeline_test.ts.
 *
 * We test the extraction logic directly since it is a pure function.
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractProcessorEventId as extractWithObj } from "../_shared/normalize.ts";
import type { ProcessorName } from "../_shared/types.ts";

// The real function also takes the nested Stripe object, which it does not read.
function extractProcessorEventId(
  processor: ProcessorName,
  p: Record<string, unknown>,
  correlationId: string,
): string {
  return extractWithObj(processor, p, {}, correlationId);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("idempotency: Stripe same event_id produces same processor_event_id", () => {
  const payload = { id: "evt_1Abc", type: "invoice.payment_failed" };

  const id1 = extractProcessorEventId("stripe", payload, "corr-a");
  const id2 = extractProcessorEventId("stripe", payload, "corr-b"); // different corr

  assertEquals(id1, "evt_1Abc");
  assertEquals(id2, "evt_1Abc"); // correlation doesn't affect it
});

Deno.test("idempotency: Stripe different event_id produces different processor_event_id", () => {
  const payload1 = { id: "evt_1Abc" };
  const payload2 = { id: "evt_2Xyz" };

  const id1 = extractProcessorEventId("stripe", payload1, "corr-a");
  const id2 = extractProcessorEventId("stripe", payload2, "corr-a");

  assertNotEquals(id1, id2);
});

Deno.test("idempotency: Adyen same pspReference produces same processor_event_id", () => {
  const payload = {
    notificationItems: [{
      NotificationRequestItem: {
        pspReference: "PSP_9876543210",
        eventCode: "AUTHORISATION",
      },
    }],
  };

  const id1 = extractProcessorEventId("adyen", payload, "corr-a");
  const id2 = extractProcessorEventId("adyen", payload, "corr-b");

  assertEquals(id1, "PSP_9876543210");
  assertEquals(id2, "PSP_9876543210");
});

Deno.test("idempotency: Adyen falls back to top-level pspReference", () => {
  const payload = { pspReference: "PSP_TOPLEVEL" };

  const id = extractProcessorEventId("adyen", payload, "corr-c");
  assertEquals(id, "PSP_TOPLEVEL");
});

Deno.test("idempotency: Braintree same bt_signature produces same processor_event_id", () => {
  const payload = { bt_signature: "pubkey|hexsig", bt_payload: "base64payload" };

  const id1 = extractProcessorEventId("braintree", payload, "corr-a");
  const id2 = extractProcessorEventId("braintree", payload, "corr-b");

  assertEquals(id1, "pubkey|hexsig");
  assertEquals(id2, "pubkey|hexsig");
});

Deno.test("idempotency: unknown Stripe event falls back with correlation prefix", () => {
  const payload = {}; // no id

  const id = extractProcessorEventId("stripe", payload, "unique-corr-xyz");
  assertEquals(id, "stripe-unknown-unique-corr-xyz");
});

Deno.test("idempotency: Stripe falls back to event_id", () => {
  assertEquals(extractProcessorEventId("stripe", { event_id: "evt_alt" }, "corr"), "evt_alt");
});

Deno.test("idempotency: Adyen and Braintree fall back with correlation prefix", () => {
  assertEquals(extractProcessorEventId("adyen", {}, "c1"), "adyen-unknown-c1");
  assertEquals(extractProcessorEventId("braintree", {}, "c2"), "braintree-unknown-c2");
  assertEquals(extractProcessorEventId("braintree", { id: "bt_id" }, "c3"), "bt_id");
});
