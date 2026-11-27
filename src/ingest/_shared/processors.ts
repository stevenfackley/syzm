/**
 * Real payment processor adapters.
 * Uses ONLY tokenized references — no raw card numbers.
 * Every call sends the attempt's Idempotency-Key (see RetryAttempt), so a
 * repeat of the same attempt is not charged twice by Stripe or Adyen.
 */

import { classifyStripeDecline, stripeErrorCode } from "./declines.ts";
import { type DeclineCategory, NO_RETRY_CATEGORIES, type ProcessorName } from "./types.ts";

// ─── Public types ────────────────────────────────────────────────────────────

export type RetryAttempt = {
  invoiceId: string;
  amountCents: number;
  /**
   * Tokenized payment reference.
   * Stripe: "pi_<id>|pm_<id>|cu_<id>" (PaymentIntent|PaymentMethod|Customer)
   * Adyen: "shopperReference|recurringDetailReference"
   * Braintree: "paymentMethodToken"
   *
   * TODO: The caller (execute-retries.ts) must populate this field from the
   * queue row's `payment_token` column (to be added if not present).
   */
  paymentToken: string;
  /**
   * The same for every repeat of one attempt on one queue row and different
   * for the next attempt (retry-worker.ts attemptIdempotencyKey). At most 64
   * characters, Adyen's limit.
   */
  idempotencyKey: string;
  /** The queue row being retried; recorded at the processor next to the key. */
  queueRowId: string;
};

export type RetryResult = {
  ok: boolean;
  processor: ProcessorName;
  declineCategory: DeclineCategory;
  /** Processor's own reference for the successful charge (present only when ok=true). */
  processorReference?: string;
  /** Raw processor response code for audit trail. */
  rawDeclineCode?: string;
  /**
   * Whether a declined attempt may be tried again. Stripe: the decline table
   * in declines.ts, which the webhook uses too. Adyen and Braintree: every
   * category but fraud and lost_stolen (NO_RETRY_CATEGORIES).
   */
  retryable: boolean;
  /**
   * The answer does not say whether the charge happened: an HTTP status of 500
   * or above, a 409 (Stripe's answer while another request with the same
   * idempotency key is in flight), or a body that is not JSON (a gateway or
   * proxy page). Stripe treats a 500 as indeterminate. The worker handles it
   * like a network error: it repeats the same attempt under the same key and
   * never moves on to a new key while the first outcome is unknown.
   */
  indeterminate?: boolean;
};

/** What an adapter returns; retryPayment fills `retryable` when it is left out. */
type AdapterResult = Omit<RetryResult, "retryable"> & { retryable?: boolean };

// ─── Processor credentials (injected at call time) ───────────────────────────

export type ProcessorCredentials = {
  stripeApiKey: string;
  adyenApiKey: string;
  adyenMerchantAccount: string;
  braintreePublicKey: string;
  braintreePrivateKey: string;
  braintreeMerchantId: string;
};

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function retryPayment(
  processor: ProcessorName,
  attempt: RetryAttempt,
  creds: ProcessorCredentials,
  correlationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RetryResult> {
  console.log(
    JSON.stringify({
      event: "retry_attempt_start",
      processor,
      invoice_id: attempt.invoiceId,
      amount_cents: attempt.amountCents,
      correlation_id: correlationId,
    }),
  );

  let adapterResult: AdapterResult;
  switch (processor) {
    case "stripe":
      adapterResult = await retryStripe(attempt, creds, fetchImpl);
      break;
    case "adyen":
      adapterResult = await retryAdyen(attempt, creds, fetchImpl);
      break;
    case "braintree":
      adapterResult = await retryBraintree(attempt, creds, fetchImpl);
      break;
  }
  const result: RetryResult = {
    ...adapterResult,
    retryable: adapterResult.retryable ?? !NO_RETRY_CATEGORIES.has(adapterResult.declineCategory),
  };

  console.log(
    JSON.stringify({
      event: "retry_attempt_end",
      processor,
      invoice_id: attempt.invoiceId,
      ok: result.ok,
      decline_category: result.declineCategory,
      raw_decline_code: result.rawDeclineCode,
      retryable: result.retryable,
      indeterminate: result.indeterminate ?? false,
      correlation_id: correlationId,
    }),
  );

  return result;
}

/**
 * Parse a processor response body. Returns null when the body is not a JSON
 * object (e.g. an HTML error page from a gateway or proxy) so the caller can
 * report an unknown outcome instead of throwing.
 */
async function readJsonBody(resp: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await resp.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** A status that does not say whether the charge happened (see RetryResult.indeterminate). */
function isIndeterminateStatus(resp: Response): boolean {
  return resp.status >= 500 || resp.status === 409;
}

/** An answer that does not say whether the charge happened (RetryResult.indeterminate). */
function unknownOutcome(processor: ProcessorName, rawDeclineCode: string): AdapterResult {
  return {
    ok: false,
    processor,
    declineCategory: "transient",
    rawDeclineCode,
    indeterminate: true,
  };
}

// ─── Stripe ──────────────────────────────────────────────────────────────────
//
// Token format: "<paymentIntentId>|<paymentMethodId>|<customerId>"
// OR just "<paymentMethodId>|<customerId>" to create a new PaymentIntent.
// We confirm an existing PaymentIntent if we have one; otherwise create.

const STRIPE_BASE = "https://api.stripe.com/v1";

async function retryStripe(
  attempt: RetryAttempt,
  creds: ProcessorCredentials,
  fetchImpl: typeof fetch,
): Promise<AdapterResult> {
  const parts = attempt.paymentToken.split("|");
  if (parts.length < 2) {
    // Not a Stripe token. Routing sends other processors' rows here too, so
    // this is not terminal: the row goes on to its own processor.
    return {
      ok: false,
      processor: "stripe",
      declineCategory: "invalid_data",
      rawDeclineCode: "bad_payment_token",
    };
  }

  const idempotencyKey = attempt.idempotencyKey;
  const authHeader = `Bearer ${creds.stripeApiKey}`;

  let url: string;
  let body: URLSearchParams;

  // An attempt that ends with an unknown outcome is reconciled by finding it at
  // Stripe. A PaymentIntent created here carries the attempt key and the row
  // id in its metadata. The confirm endpoint takes no metadata, so a confirmed
  // existing PaymentIntent is found by the Idempotency-Key in Stripe's request log.
  if (parts[0].startsWith("pi_")) {
    // Confirm existing PaymentIntent
    const paymentIntentId = parts[0];
    const paymentMethodId = parts[1];
    url = `${STRIPE_BASE}/payment_intents/${encodeURIComponent(paymentIntentId)}/confirm`;
    body = new URLSearchParams({
      payment_method: paymentMethodId,
    });
  } else {
    // parts[0] = payment_method, parts[1] = customer
    const paymentMethodId = parts[0];
    const customerId = parts[1];
    url = `${STRIPE_BASE}/payment_intents`;
    body = new URLSearchParams({
      amount: String(attempt.amountCents),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: "true",
      off_session: "true",
      "metadata[syzm_attempt_key]": idempotencyKey,
      "metadata[syzm_queue_row_id]": attempt.queueRowId,
    });
  }

  const resp = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: body.toString(),
  });

  const json = await readJsonBody(resp);
  if (!json || isIndeterminateStatus(resp)) return unknownOutcome("stripe", `http_${resp.status}`);

  if (resp.ok) {
    const status = json.status as string | undefined;
    if (status === "succeeded") {
      return {
        ok: true,
        processor: "stripe",
        declineCategory: "unknown",
        processorReference: json.id as string,
      };
    }
    // "processing": Stripe has not finished; the payment can still fail. Not a
    // recovery and not a decline: the same attempt is asked again later.
    if (status === "processing") return unknownOutcome("stripe", "processing");
    // requires_action / requires_payment_method → needs the customer to
    // authenticate or pay another way; Stripe lists authentication_required
    // as a hard decline (declines.ts).
    if (status === "requires_action" || status === "requires_payment_method") {
      return {
        ok: false,
        processor: "stripe",
        declineCategory: "authentication_required",
        rawDeclineCode: status,
        retryable: false,
      };
    }
  }

  // Error path
  const err = (json.error ?? {}) as Record<string, unknown>;
  // An idempotency_error (for example the same key sent with different
  // parameters) says nothing about the first request under that key.
  if (err.type === "idempotency_error") return unknownOutcome("stripe", "idempotency_error");
  const rawCode = stripeErrorCode(err) ?? "unknown";
  const decline = classifyStripeDecline(rawCode);
  return {
    ok: false,
    processor: "stripe",
    declineCategory: decline.category,
    rawDeclineCode: rawCode,
    retryable: decline.retryable,
  };
}

// ─── Adyen ───────────────────────────────────────────────────────────────────
//
// Token format: "<shopperReference>|<recurringDetailReference>"
// Makes a /payments call with ContAuth selected stored credential.

const ADYEN_BASE = "https://checkout-test.adyen.com/v71";

async function retryAdyen(
  attempt: RetryAttempt,
  creds: ProcessorCredentials,
  fetchImpl: typeof fetch,
): Promise<AdapterResult> {
  const parts = attempt.paymentToken.split("|");
  if (parts.length < 2) {
    return {
      ok: false,
      processor: "adyen",
      declineCategory: "invalid_data",
      rawDeclineCode: "bad_payment_token",
    };
  }

  const [shopperReference, recurringDetailReference] = parts;
  const idempotencyKey = attempt.idempotencyKey;

  const payload = {
    merchantAccount: creds.adyenMerchantAccount,
    amount: { value: attempt.amountCents, currency: "USD" },
    reference: idempotencyKey,
    shopperReference,
    recurringProcessingModel: "Subscription",
    shopperInteraction: "ContAuth",
    paymentMethod: {
      type: "scheme",
      storedPaymentMethodId: recurringDetailReference,
    },
  };

  const resp = await fetchImpl(`${ADYEN_BASE}/payments`, {
    method: "POST",
    headers: {
      "X-API-Key": creds.adyenApiKey,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonBody(resp);
  if (!json || isIndeterminateStatus(resp)) return unknownOutcome("adyen", `http_${resp.status}`);
  const resultCode = String(json.resultCode ?? "");
  const refusalReason = String(json.refusalReason ?? "");

  if (resultCode === "Authorised") {
    return {
      ok: true,
      processor: "adyen",
      declineCategory: "unknown",
      processorReference: String(json.pspReference ?? ""),
    };
  }

  return {
    ok: false,
    processor: "adyen",
    declineCategory: mapAdyenRefusalReason(refusalReason, resultCode),
    rawDeclineCode: `${resultCode}:${refusalReason}`,
  };
}

export function mapAdyenRefusalReason(refusalReason: string, resultCode: string): DeclineCategory {
  const r = refusalReason.toLowerCase();
  if (resultCode === "RedirectShopper" || r.includes("3d secure") || r.includes("authentication")) {
    return "authentication_required";
  }
  if (r.includes("fraud") || r.includes("blocked")) return "fraud";
  if (r.includes("stolen") || r.includes("lost")) return "lost_stolen";
  if (r.includes("insufficient") || r.includes("balance") || r.includes("funds")) {
    return "insufficient_funds";
  }
  if (r.includes("expired")) return "expired_card";
  if (r.includes("invalid") || r.includes("format")) return "invalid_data";
  if (r.includes("do not") || r.includes("do_not") || r.includes("honour")) return "do_not_honor";
  if (r.includes("velocity") || r.includes("frequency") || r.includes("limit")) return "velocity";
  if (r.includes("unavailable") || r.includes("try again") || resultCode === "Error") {
    return "transient";
  }
  return "unknown";
}

// ─── Braintree ───────────────────────────────────────────────────────────────
//
// Token format: "<paymentMethodToken>"
// Uses Braintree's GraphQL API (newer; falls back shape).
// TODO: For full production use, integrate the braintree npm SDK or use the
//       GraphQL endpoint with Basic auth (public:private key base64).

const BRAINTREE_BASE = "https://payments.sandbox.braintree-api.com/graphql";

async function retryBraintree(
  attempt: RetryAttempt,
  creds: ProcessorCredentials,
  fetchImpl: typeof fetch,
): Promise<AdapterResult> {
  const paymentMethodToken = attempt.paymentToken;
  const idempotencyKey = attempt.idempotencyKey;

  const amountDollars = (attempt.amountCents / 100).toFixed(2);

  // Braintree GraphQL: charge a vaulted payment method
  const query = `
    mutation ChargeVaultedPaymentMethod($input: ChargeVaultedPaymentMethodInput!) {
      chargeVaultedPaymentMethod(input: $input) {
        transaction {
          id
          status
          processorResponse {
            legacyCode
            message
          }
        }
      }
    }
  `;

  const variables = {
    input: {
      paymentMethodId: paymentMethodToken,
      transaction: {
        amount: amountDollars,
        orderId: idempotencyKey,
      },
    },
  };

  const basicAuth = btoa(`${creds.braintreePublicKey}:${creds.braintreePrivateKey}`);

  const resp = await fetchImpl(BRAINTREE_BASE, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Braintree-Version": "2019-01-01",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await readJsonBody(resp);
  if (!json || isIndeterminateStatus(resp)) return unknownOutcome("braintree", `http_${resp.status}`);

  if (!resp.ok) {
    return {
      ok: false,
      processor: "braintree",
      declineCategory: "transient",
      rawDeclineCode: `http_${resp.status}`,
    };
  }

  const errors = (json.errors as unknown[] | undefined);
  if (errors && errors.length > 0) {
    return {
      ok: false,
      processor: "braintree",
      declineCategory: "invalid_data",
      rawDeclineCode: JSON.stringify(errors[0]),
    };
  }

  const data = json.data as Record<string, unknown> | undefined;
  const tx = (data?.chargeVaultedPaymentMethod as Record<string, unknown> | undefined)?.transaction as Record<string, unknown> | undefined;

  if (!tx) {
    return {
      ok: false,
      processor: "braintree",
      declineCategory: "transient",
      rawDeclineCode: "no_transaction_in_response",
    };
  }

  const status = String(tx.status ?? "");
  const processorResponse = (tx.processorResponse ?? {}) as Record<string, unknown>;
  const legacyCode = String(processorResponse.legacyCode ?? "");
  const message = String(processorResponse.message ?? "");

  if (status === "SUBMITTED_FOR_SETTLEMENT" || status === "AUTHORIZED" || status === "SETTLED") {
    return {
      ok: true,
      processor: "braintree",
      declineCategory: "unknown",
      processorReference: String(tx.id ?? ""),
    };
  }

  return {
    ok: false,
    processor: "braintree",
    declineCategory: mapBraintreeResponseCode(legacyCode, message),
    rawDeclineCode: `${legacyCode}:${message}`,
  };
}

function mapBraintreeResponseCode(legacyCode: string, message: string): DeclineCategory {
  // Braintree processor response codes: https://developer.paypal.com/braintree/docs/reference/general/processor-responses
  switch (legacyCode) {
    case "2001":
      return "insufficient_funds";
    case "2002":
    case "2003":
      return "velocity";
    case "2004":
      return "expired_card";
    case "2005":
    case "2006":
      return "invalid_data";
    case "2007":
    case "2008":
      return "invalid_data";
    case "2009":
      return "do_not_honor";
    case "2010":
      return "invalid_data";
    case "2015":
      return "do_not_honor";
    case "2016":
      return "transient";
    case "2023":
    case "2024":
      return "lost_stolen";
    case "2038":
      return "do_not_honor";
    case "2046":
      return "do_not_honor";
    case "2053":
      return "lost_stolen";
    case "2054":
      return "lost_stolen";
    case "2063":
      return "fraud";
    case "2074":
      return "authentication_required";
    default: {
      const m = message.toLowerCase();
      if (m.includes("fraud")) return "fraud";
      if (m.includes("stolen") || m.includes("lost")) return "lost_stolen";
      if (m.includes("insufficient")) return "insufficient_funds";
      if (m.includes("expired")) return "expired_card";
      return "unknown";
    }
  }
}
