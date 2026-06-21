/**
 * Real payment processor adapters.
 * Uses ONLY tokenized references — no raw card numbers.
 * All calls include an Idempotency-Key to prevent double charges on retry.
 */

import type { DeclineCategory, ProcessorName } from "./types.ts";

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
};

export type RetryResult = {
  ok: boolean;
  processor: ProcessorName;
  declineCategory: DeclineCategory;
  /** Processor's own reference for the successful charge (present only when ok=true). */
  processorReference?: string;
  /** Raw processor response code for audit trail. */
  rawDeclineCode?: string;
};

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

  let result: RetryResult;
  switch (processor) {
    case "stripe":
      result = await retryStripe(attempt, creds, correlationId, fetchImpl);
      break;
    case "adyen":
      result = await retryAdyen(attempt, creds, correlationId, fetchImpl);
      break;
    case "braintree":
      result = await retryBraintree(attempt, creds, correlationId, fetchImpl);
      break;
  }

  console.log(
    JSON.stringify({
      event: "retry_attempt_end",
      processor,
      invoice_id: attempt.invoiceId,
      ok: result.ok,
      decline_category: result.declineCategory,
      raw_decline_code: result.rawDeclineCode,
      correlation_id: correlationId,
    }),
  );

  return result;
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
  correlationId: string,
  fetchImpl: typeof fetch,
): Promise<RetryResult> {
  const parts = attempt.paymentToken.split("|");
  if (parts.length < 2) {
    return {
      ok: false,
      processor: "stripe",
      declineCategory: "invalid_data",
      rawDeclineCode: "bad_payment_token",
    };
  }

  const idempotencyKey = `syzm-retry-${attempt.invoiceId}-stripe-${correlationId}`;
  const authHeader = `Bearer ${creds.stripeApiKey}`;

  let url: string;
  let body: URLSearchParams;

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

  const json = await resp.json() as Record<string, unknown>;

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
    // requires_action / requires_payment_method → needs auth
    if (status === "requires_action" || status === "requires_payment_method") {
      return {
        ok: false,
        processor: "stripe",
        declineCategory: "authentication_required",
        rawDeclineCode: status,
      };
    }
  }

  // Error path
  const err = (json.error ?? {}) as Record<string, unknown>;
  const rawCode = String(err.decline_code ?? err.code ?? "unknown");
  return {
    ok: false,
    processor: "stripe",
    declineCategory: mapStripeDeclineCode(rawCode),
    rawDeclineCode: rawCode,
  };
}

function mapStripeDeclineCode(code: string): DeclineCategory {
  switch (code) {
    case "insufficient_funds":
    case "card_decline_rate_limit_exceeded":
      return "insufficient_funds";
    case "do_not_honor":
    case "generic_decline":
    case "card_declined":
      return "do_not_honor";
    case "lost_card":
    case "stolen_card":
      return "lost_stolen";
    case "fraudulent":
    case "fraud":
      return "fraud";
    case "expired_card":
      return "expired_card";
    case "incorrect_number":
    case "invalid_number":
    case "invalid_expiry_month":
    case "invalid_expiry_year":
    case "invalid_cvc":
      return "invalid_data";
    case "issuer_not_available":
    case "try_again_later":
    case "processing_error":
      return "transient";
    case "card_velocity_exceeded":
    case "withdrawal_count_limit_exceeded":
      return "velocity";
    case "authentication_required":
      return "authentication_required";
    default:
      return "unknown";
  }
}

// ─── Adyen ───────────────────────────────────────────────────────────────────
//
// Token format: "<shopperReference>|<recurringDetailReference>"
// Makes a /payments call with ContAuth selected stored credential.

const ADYEN_BASE = "https://checkout-test.adyen.com/v71";

async function retryAdyen(
  attempt: RetryAttempt,
  creds: ProcessorCredentials,
  correlationId: string,
  fetchImpl: typeof fetch,
): Promise<RetryResult> {
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
  const idempotencyKey = `syzm-retry-${attempt.invoiceId}-adyen-${correlationId}`;

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

  const json = await resp.json() as Record<string, unknown>;
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

function mapAdyenRefusalReason(refusalReason: string, resultCode: string): DeclineCategory {
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
  correlationId: string,
  fetchImpl: typeof fetch,
): Promise<RetryResult> {
  const paymentMethodToken = attempt.paymentToken;
  const idempotencyKey = `syzm-retry-${attempt.invoiceId}-bt-${correlationId}`;

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

  const json = await resp.json() as Record<string, unknown>;

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
