/**
 * Tests for _shared/processors.ts — real processor adapters with fetch mocking.
 *
 * Covers: decline-code mapping per processor, Idempotency-Key header sent,
 * ok=true on success, ok=false with correct category on various declines.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
  idempotencyKey: "syzm-row-stripe-attempt-1",
  queueRowId: "row-stripe",
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

/** A gateway or proxy error page: not JSON. */
function makeHtmlFetchMock(status: number): typeof fetch {
  return (async () =>
    new Response("<html><body>502 Bad Gateway</body></html>", {
      status,
      headers: { "content-type": "text/html" },
    })) as typeof fetch;
}

// ─── Non-JSON responses (one bad row must not throw and end the batch) ───────

Deno.test("Stripe: non-JSON error page returns transient instead of throwing", async () => {
  const result = await retryPayment("stripe", attempt, creds, "corr-html-1", makeHtmlFetchMock(502));

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "transient");
  assertEquals(result.rawDeclineCode, "http_502");
});

Deno.test("Adyen: non-JSON error page returns transient instead of throwing", async () => {
  const result = await retryPayment(
    "adyen",
    { invoiceId: "inv_adyen_html", amountCents: 2500, paymentToken: "shopper123|detail456", idempotencyKey: "k-adyen-html", queueRowId: "r" },
    creds,
    "corr-html-2",
    makeHtmlFetchMock(502),
  );

  assertEquals(result.ok, false);
  assertEquals(result.declineCategory, "transient");
  assertEquals(result.rawDeclineCode, "http_502");
});

Deno.test("Braintree: non-JSON error page returns transient instead of throwing", async () => {
  const btHtmlAttempt = { invoiceId: "inv_bt_html", amountCents: 3000, paymentToken: "pmt_abc", idempotencyKey: "k-bt-html", queueRowId: "r" };

  const on502 = await retryPayment("braintree", btHtmlAttempt, creds, "corr-html-3", makeHtmlFetchMock(502));
  assertEquals(on502.ok, false);
  assertEquals(on502.declineCategory, "transient");
  assertEquals(on502.rawDeclineCode, "http_502");

  const on200 = await retryPayment("braintree", btHtmlAttempt, creds, "corr-html-4", makeHtmlFetchMock(200));
  assertEquals(on200.ok, false);
  assertEquals(on200.declineCategory, "transient");
  assertEquals(on200.rawDeclineCode, "http_200");
});

// ─── Answers that do not say whether the card was charged ────────────────────

const ATTEMPT_FOR: Record<"stripe" | "adyen" | "braintree", typeof attempt> = {
  stripe: attempt,
  adyen: { invoiceId: "inv_a", amountCents: 2500, paymentToken: "shopper123|detail456", idempotencyKey: "k-a", queueRowId: "r" },
  braintree: { invoiceId: "inv_b", amountCents: 3000, paymentToken: "pmt_abc", idempotencyKey: "k-b", queueRowId: "r" },
};

Deno.test("every processor: a 5xx, a 409 or a body that is not JSON is indeterminate", async () => {
  for (const processor of ["stripe", "adyen", "braintree"] as const) {
    for (const status of [500, 502, 503, 409]) {
      const json = await retryPayment(processor, ATTEMPT_FOR[processor], creds, "c", makeFetchMock({ error: {} }, status));
      assertEquals([json.ok, json.indeterminate, json.rawDeclineCode], [false, true, `http_${status}`], `${processor} ${status}`);
    }
    for (const status of [200, 502]) {
      const html = await retryPayment(processor, ATTEMPT_FOR[processor], creds, "c", makeHtmlFetchMock(status));
      assertEquals([html.ok, html.indeterminate], [false, true], `${processor} html ${status}`);
    }
  }
});

Deno.test("Stripe: an idempotency_error is indeterminate, not a decline", async () => {
  const result = await retryPayment(
    "stripe",
    attempt,
    creds,
    "c",
    makeFetchMock({ error: { type: "idempotency_error", message: "Keys for idempotent requests can only be used with the same parameters" } }, 400),
  );
  assertEquals([result.ok, result.indeterminate, result.rawDeclineCode], [false, true, "idempotency_error"]);
});

Deno.test("every processor: a decline the processor states is not indeterminate", async () => {
  const stripe = await retryPayment(
    "stripe",
    attempt,
    creds,
    "c",
    makeFetchMock({ error: { code: "card_declined", decline_code: "insufficient_funds" } }, 402),
  );
  const adyen = await retryPayment(
    "adyen",
    ATTEMPT_FOR.adyen,
    creds,
    "c",
    makeFetchMock({ resultCode: "Refused", refusalReason: "Not enough balance" }),
  );
  const braintree = await retryPayment(
    "braintree",
    ATTEMPT_FOR.braintree,
    creds,
    "c",
    makeFetchMock({
      data: {
        chargeVaultedPaymentMethod: {
          transaction: { id: "t", status: "PROCESSOR_DECLINED", processorResponse: { legacyCode: "2001", message: "x" } },
        },
      },
    }),
  );
  for (const result of [stripe, adyen, braintree]) {
    assertEquals([result.ok, result.indeterminate ?? false, result.declineCategory], [false, false, "insufficient_funds"]);
  }
});

// ─── Stripe tests ─────────────────────────────────────────────────────────────

Deno.test("Stripe: approved PaymentIntent returns ok=true", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock({ id: "pi_test", status: "succeeded" }, 200, captured);

  const result = await retryPayment("stripe", attempt, creds, "corr-1", mockFetch);

  assertEquals(result.ok, true);
  assertEquals(result.processor, "stripe");
  assertEquals(result.processorReference, "pi_test");
});

Deno.test("Stripe: sends the attempt's Idempotency-Key header, whatever the correlation id", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock({ id: "pi_test", status: "succeeded" }, 200, captured);

  await retryPayment("stripe", attempt, creds, "corr-idempotent", mockFetch);
  await retryPayment("stripe", attempt, creds, "corr-other-run", mockFetch);

  assertEquals(captured.length, 2);
  assertEquals(captured[0].headers.get("Idempotency-Key"), attempt.idempotencyKey);
  assertEquals(captured[1].headers.get("Idempotency-Key"), attempt.idempotencyKey);
});

Deno.test("Stripe: a PaymentIntent it creates carries the attempt key and the queue row id", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock({ id: "pi_test", status: "succeeded" }, 200, captured);

  await retryPayment("stripe", attempt, creds, "corr-meta", mockFetch);

  assertEquals(captured[0].url, "https://api.stripe.com/v1/payment_intents");
  const form = new URLSearchParams(await captured[0].text());
  assertEquals(form.get("metadata[syzm_attempt_key]"), attempt.idempotencyKey);
  assertEquals(form.get("metadata[syzm_queue_row_id]"), attempt.queueRowId);
});

Deno.test("Stripe: confirming an existing PaymentIntent sends the key only as the Idempotency-Key", async () => {
  // The confirm endpoint takes no metadata.
  const captured: Request[] = [];
  const mockFetch = makeFetchMock({ id: "pi_existing", status: "succeeded" }, 200, captured);

  await retryPayment("stripe", { ...attempt, paymentToken: "pi_existing|pm_test|cu_test" }, creds, "c", mockFetch);

  assertEquals(captured[0].url, "https://api.stripe.com/v1/payment_intents/pi_existing/confirm");
  assertEquals(captured[0].headers.get("Idempotency-Key"), attempt.idempotencyKey);
  assertEquals([...new URLSearchParams(await captured[0].text()).keys()], ["payment_method"]);
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

Deno.test("Stripe: processing PaymentIntent is neither a decline nor a recovery", async () => {
  // The charge is settling and can still succeed or fail. A decline would
  // reschedule it onto another attempt; a recovery would be recorded before the
  // money is there. It is indeterminate: the same attempt is asked again later.
  const mockFetch = makeFetchMock({ id: "pi_processing", status: "processing" }, 200);

  const result = await retryPayment("stripe", attempt, creds, "corr-processing", mockFetch);

  assertEquals([result.ok, result.indeterminate, result.rawDeclineCode], [false, true, "processing"]);
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
  idempotencyKey: "syzm-row-adyen-attempt-1",
  queueRowId: "row-adyen",
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

Deno.test("Adyen: sends the attempt's Idempotency-Key header and uses it as the reference", async () => {
  const captured: Request[] = [];
  const mockFetch = makeFetchMock({ resultCode: "Authorised", pspReference: "p" }, 200, captured);

  await retryPayment("adyen", adyenAttempt, creds, "corr-adyen-key", mockFetch);

  assertEquals(captured[0].headers.get("Idempotency-Key"), adyenAttempt.idempotencyKey);
  assertEquals((await captured[0].json()).reference, adyenAttempt.idempotencyKey);
});

Deno.test("Adyen: Received and Pending are indeterminate, not declines", async () => {
  for (const resultCode of ["Received", "Pending"]) {
    const result = await retryPayment(
      "adyen",
      adyenAttempt,
      creds,
      "c",
      makeFetchMock({ resultCode, pspReference: "psp_pending" }),
    );
    assertEquals([result.ok, result.indeterminate, result.rawDeclineCode], [false, true, resultCode]);
  }
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
  idempotencyKey: "syzm-row-bt-attempt-1",
  queueRowId: "row-bt",
};

function btTransaction(status: string): typeof fetch {
  return makeFetchMock({
    data: {
      chargeVaultedPaymentMethod: {
        transaction: { id: "tx_s", status, processorResponse: { legacyCode: "2001", message: "Insufficient Funds" } },
      },
    },
  });
}

Deno.test("Braintree: a status still in progress, or one it does not know, is indeterminate", async () => {
  for (const status of ["AUTHORIZING", "SETTLING", "SETTLEMENT_PENDING", "SETTLEMENT_CONFIRMED", "SOMETHING_NEW", ""]) {
    const result = await retryPayment("braintree", btAttempt, creds, "c", btTransaction(status));
    assertEquals([result.ok, result.indeterminate], [false, true], status);
  }
});

Deno.test("Braintree: a status after which no money moved is a decline", async () => {
  for (const status of ["PROCESSOR_DECLINED", "GATEWAY_REJECTED", "FAILED", "SETTLEMENT_DECLINED", "VOIDED", "AUTHORIZATION_EXPIRED"]) {
    const result = await retryPayment("braintree", btAttempt, creds, "c", btTransaction(status));
    assertEquals([result.ok, result.indeterminate ?? false, result.declineCategory], [false, false, "insufficient_funds"], status);
  }
});

Deno.test("Braintree: a 200 with no transaction, or an INTERNAL GraphQL error, is indeterminate", async () => {
  const noTx = await retryPayment("braintree", btAttempt, creds, "c", makeFetchMock({ data: {} }));
  assertEquals([noTx.indeterminate, noTx.rawDeclineCode], [true, "no_transaction_in_response"]);

  for (const errorClass of ["INTERNAL", "SERVICE_AVAILABILITY"]) {
    const result = await retryPayment(
      "braintree",
      btAttempt,
      creds,
      "c",
      makeFetchMock({ errors: [{ message: "x", extensions: { errorClass } }] }),
    );
    assertEquals([result.indeterminate, result.rawDeclineCode], [true, `graphql_${errorClass}`]);
  }

  const validation = await retryPayment(
    "braintree",
    btAttempt,
    creds,
    "c",
    makeFetchMock({ errors: [{ message: "bad id", extensions: { errorClass: "VALIDATION" } }] }),
  );
  assertEquals([validation.indeterminate ?? false, validation.declineCategory], [false, "invalid_data"]);
});

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

  assertEquals(captured[0].headers.get("Idempotency-Key"), btAttempt.idempotencyKey);
  // The transaction's orderId is the attempt key too, so it can be found in Braintree.
  assertEquals((await captured[0].json()).variables.input.transaction.orderId, btAttempt.idempotencyKey);
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
