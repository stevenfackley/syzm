/**
 * Tests for _shared/processors.ts — real processor adapters with fetch mocking.
 *
 * Covers: decline-code mapping per processor, Idempotency-Key header sent,
 * ok=true on success, ok=false with correct category on various declines.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { retryPayment, type ProcessorCredentials } from "../_shared/processors.ts";

// ─── Test credentials ────────────────────────────────────────────────────────

const creds: ProcessorCredentials = {
  stripeApiKey: "sk_test_1234",
  adyenApiKey: "adyen_test_key",
  adyenMerchantAccount: "TestMerchant",
  braintreePublicKey: "pub",
  braintreePrivateKey: "priv",
  braintreeMerchantId: "merchant1",
};

const attempt = {
  invoiceId: "inv_test_001",
  amountCents: 1999,
  paymentToken: "pm_test|cu_test",
};

// ─── Fetch mock helper ────────────────────────────────────────────────────────

function makeFetchMock(
  responseBody: unknown,
  status = 200,
  captureRequests?: Array<Request>,
): typeof fetch {
  return (async (input: Request | URL | string, init?: RequestInit) => {
    if (captureRequests) {
      captureRequests.push(
        new Request(typeof input === "string" ? input : input.toString(), init),
      );
    }
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

// ─── Stripe tests ─────────────────────────────────────────────────────────────

Deno.test("Stripe: approved PaymentIntent returns ok=true", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock({ id: "pi_test", status: "succeeded" }, 200, captured);

  const result = await retryPayment("stripe", attempt, creds, "corr-1", mockFetch);

  assertEquals(result.ok, true);
  assertEquals(result.processor, "stripe");
  assertEquals(result.processorReference, "pi_test");
});

Deno.test("Stripe: sends Idempotency-Key header", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock({ id: "pi_test", status: "succeeded" }, 200, captured);

  await retryPayment("stripe", attempt, creds, "corr-idempotent", mockFetch);

  assertEquals(captured.length > 0, true);
  const idempKey = captured[0].headers.get("Idempotency-Key");
  assertStringIncludes(idempKey ?? "", "inv_test_001");
  assertStringIncludes(idempKey ?? "", "stripe");
});

Deno.test("Stripe: insufficient_funds decline maps correctly", async () => {
  const mockFetch = makeFetchMock(
    { error: { decline_code: "insufficient_funds", code: "card_declined" } },
    402,
  );

  const result = await retryPayment("stripe", attempt, creds, "corr-2", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "insufficient_funds");
  assertEquals(result.rawDeclineCode, "insufficient_funds");
});

Deno.test("Stripe: lost_card maps to lost_stolen", async () => {
  const mockFetch = makeFetchMock(
    { error: { decline_code: "lost_card" } },
    402,
  );

  const result = await retryPayment("stripe", attempt, creds, "corr-3", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "lost_stolen");
});

Deno.test("Stripe: fraudulent maps to fraud", async () => {
  const mockFetch = makeFetchMock(
    { error: { decline_code: "fraudulent" } },
    402,
  );

  const result = await retryPayment("stripe", attempt, creds, "corr-4", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "fraud");
});

Deno.test("Stripe: expired_card maps correctly", async () => {
  const mockFetch = makeFetchMock(
    { error: { decline_code: "expired_card" } },
    402,
  );

  const result = await retryPayment("stripe", attempt, creds, "corr-5", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "expired_card");
});

Deno.test("Stripe: requires_action maps to authentication_required", async () => {
  const mockFetch = makeFetchMock({ id: "pi_abc", status: "requires_action" }, 200);

  const result = await retryPayment("stripe", attempt, creds, "corr-6", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "authentication_required");
});

// ─── Adyen tests ──────────────────────────────────────────────────────────────

const adyenAttempt = {
  invoiceId: "inv_adyen_001",
  amountCents: 2500,
  paymentToken: "shopper123|detail456",
};

Deno.test("Adyen: Authorised result returns ok=true", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock(
    { resultCode: "Authorised", pspReference: "psp_abc" },
    200,
    captured,
  );

  const result = await retryPayment("adyen", adyenAttempt, creds, "corr-adyen-1", mockFetch);

  assertEquals(result.ok, true);
  assertEquals(result.processorReference, "psp_abc");
});

Deno.test("Adyen: sends Idempotency-Key header", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock({ resultCode: "Authorised", pspReference: "p" }, 200, captured);

  await retryPayment("adyen", adyenAttempt, creds, "corr-adyen-key", mockFetch);

  const idempKey = captured[0].headers.get("Idempotency-Key");
  assertStringIncludes(idempKey ?? "", "inv_adyen_001");
});

Deno.test("Adyen: Refused with insufficient funds maps correctly", async () => {
  const mockFetch = makeFetchMock(
    { resultCode: "Refused", refusalReason: "Not enough balance" },
    200,
  );

  const result = await retryPayment("adyen", adyenAttempt, creds, "corr-adyen-2", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "insufficient_funds");
});

Deno.test("Adyen: Refused fraud maps to fraud", async () => {
  const mockFetch = makeFetchMock(
    { resultCode: "Refused", refusalReason: "FRAUD" },
    200,
  );

  const result = await retryPayment("adyen", adyenAttempt, creds, "corr-adyen-3", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "fraud");
});

Deno.test("Adyen: Error resultCode maps to transient", async () => {
  const mockFetch = makeFetchMock({ resultCode: "Error", refusalReason: "" }, 200);

  const result = await retryPayment("adyen", adyenAttempt, creds, "corr-adyen-4", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "transient");
});

// ─── Braintree tests ──────────────────────────────────────────────────────────

const btAttempt = {
  invoiceId: "inv_bt_001",
  amountCents: 3000,
  paymentToken: "payment_method_token_abc",
};

Deno.test("Braintree: SUBMITTED_FOR_SETTLEMENT returns ok=true", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock(
    {
      data: {
        chargeVaultedPaymentMethod: {
          transaction: {
            id: "tx_bt_1",
            status: "SUBMITTED_FOR_SETTLEMENT",
            processorResponse: { legacyCode: "1000", message: "Approved" },
          },
        },
      },
    },
    200,
    captured,
  );

  const result = await retryPayment("braintree", btAttempt, creds, "corr-bt-1", mockFetch);

  assertEquals(result.ok, true);
  assertEquals(result.processorReference, "tx_bt_1");
});

Deno.test("Braintree: sends Idempotency-Key header", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock(
    {
      data: {
        chargeVaultedPaymentMethod: {
          transaction: {
            id: "tx2",
            status: "SUBMITTED_FOR_SETTLEMENT",
            processorResponse: { legacyCode: "1000", message: "OK" },
          },
        },
      },
    },
    200,
    captured,
  );

  await retryPayment("braintree", btAttempt, creds, "corr-bt-key", mockFetch);

  const idempKey = captured[0].headers.get("Idempotency-Key");
  assertStringIncludes(idempKey ?? "", "inv_bt_001");
});

Deno.test("Braintree: code 2001 (insufficient funds) maps correctly", async () => {
  const mockFetch = makeFetchMock(
    {
      data: {
        chargeVaultedPaymentMethod: {
          transaction: {
            id: "tx3",
            status: "PROCESSOR_DECLINED",
            processorResponse: { legacyCode: "2001", message: "Insufficient Funds" },
          },
        },
      },
    },
    200,
  );

  const result = await retryPayment("braintree", btAttempt, creds, "corr-bt-2", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "insufficient_funds");
});

Deno.test("Braintree: code 2063 maps to fraud", async () => {
  const mockFetch = makeFetchMock(
    {
      data: {
        chargeVaultedPaymentMethod: {
          transaction: {
            id: "tx4",
            status: "PROCESSOR_DECLINED",
            processorResponse: { legacyCode: "2063", message: "Fraud Detected" },
          },
        },
      },
    },
    200,
  );

  const result = await retryPayment("braintree", btAttempt, creds, "corr-bt-3", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "fraud");
});

Deno.test("Braintree: code 2023 maps to lost_stolen", async () => {
  const mockFetch = makeFetchMock(
    {
      data: {
        chargeVaultedPaymentMethod: {
          transaction: {
            id: "tx5",
            status: "PROCESSOR_DECLINED",
            processorResponse: { legacyCode: "2023", message: "Card Reported Lost" },
          },
        },
      },
    },
    200,
  );

  const result = await retryPayment("braintree", btAttempt, creds, "corr-bt-4", mockFetch);

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "lost_stolen");
});
