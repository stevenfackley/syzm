/**
 * Webhook payload normalization for webhook.ts, kept in _shared so tests can
 * import it (webhook.ts starts a server when imported).
 */

import { classifyByKeywords, classifyStripeDecline, stripeErrorCode } from "./declines.ts";
import { mapAdyenRefusalReason } from "./processors.ts";
import type { DeclineCategory, NormalizedDecline, ProcessorName } from "./types.ts";

// Webhook payloads are loosely shaped per processor; a permissive record keeps
// the field-coalescing below readable.
// deno-lint-ignore no-explicit-any
type LooseRecord = Record<string, any>;

export type AdyenDecline = {
  merchantReference?: string;
  /** Refusal reason text; set only for a refused AUTHORISATION. */
  reason?: string;
  amountMinorUnits?: number;
};

/**
 * Adyen nests each event under notificationItems[].NotificationRequestItem.
 * Only a refused AUTHORISATION is a decline: on a successful one `reason`
 * holds the auth code, and other failed events (refunds, captures) are not
 * declined charges.
 */
export function readAdyenDecline(payload: Record<string, unknown>): AdyenDecline {
  const item: LooseRecord | undefined = (payload as LooseRecord).notificationItems?.[0]
    ?.NotificationRequestItem;
  if (!item || typeof item !== "object") return {};

  const refused = item.eventCode === "AUTHORISATION" && String(item.success) === "false";
  return {
    merchantReference: item.merchantReference ?? undefined,
    reason: refused ? item.reason ?? undefined : undefined,
    amountMinorUnits: item.amount?.value ?? undefined,
  };
}

export function normalizeDecline(
  processor: ProcessorName,
  payload: Record<string, unknown>,
  correlationId: string,
): NormalizedDecline {
  const p = payload as LooseRecord;
  const obj = p.data?.object ?? {};
  const adyen: AdyenDecline = processor === "adyen" ? readAdyenDecline(p) : {};

  const invoiceId = String(
    p.invoice_id ??
      p.invoiceId ??
      obj.invoice ??
      adyen.merchantReference ??
      `unknown_${correlationId}`,
  );

  // Extract processor-specific idempotency id for deduplication.
  const processorEventId = extractProcessorEventId(processor, p, obj, correlationId);

  const rawDeclineCode = String(
    p.decline_code ??
      p.declineCode ??
      stripeErrorCode(obj.last_payment_error) ??
      // Adyen
      adyen.reason ??
      p.refusalReason ??
      "",
  ).toLowerCase();

  const amount = Number(
    p.amount_cents ??
      p.amount ??
      obj.amount_due ??
      adyen.amountMinorUnits ??
      0,
  );

  const declineCategory = mapRawCodeToCategory(processor, rawDeclineCode);
  const softDecline = isQueueableDecline(processor, rawDeclineCode, declineCategory);

  return {
    invoice_id: invoiceId,
    processor_event_id: processorEventId,
    decline_code: rawDeclineCode || null,
    decline_category: declineCategory,
    bank_bin: String(p.bank_bin ?? p.bankBin ?? "").slice(0, 8) || null,
    region: String(p.region ?? p.country ?? "US"),
    retry_count: Number(p.retry_count ?? 0),
    original_amount_cents: Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0,
    processor_origin: processor,
    processor_history: [processor],
    soft_decline: softDecline,
  };
}

export function extractProcessorEventId(
  processor: ProcessorName,
  p: LooseRecord,
  _obj: LooseRecord,
  correlationId: string,
): string {
  switch (processor) {
    case "stripe":
      // Stripe sends the event id at top level.
      return String(p.id ?? p.event_id ?? `stripe-unknown-${correlationId}`);
    case "adyen":
      // Adyen: pspReference is unique per notification item.
      return String(
        p.notificationItems?.[0]?.NotificationRequestItem?.pspReference ??
          p.pspReference ??
          `adyen-unknown-${correlationId}`,
      );
    case "braintree":
      // Braintree: bt_payload contains a base64'd XML; use the payload hash as id.
      return String(p.bt_signature ?? p.id ?? `braintree-unknown-${correlationId}`);
  }
}

/** Classify the lower-cased decline code a webhook carries. */
export function mapRawCodeToCategory(processor: ProcessorName, rawCode: string): DeclineCategory {
  if (!rawCode) return "unknown";
  // Adyen sends refusal text ("Not enough balance"), which the generic rules miss.
  if (processor === "adyen") return mapAdyenRefusalReason(rawCode, "");
  // Stripe: the table the retry worker classifies its own declines with.
  if (processor === "stripe") return classifyStripeDecline(rawCode).category;
  return classifyByKeywords(rawCode);
}

/** Categories the webhook queues for Adyen and Braintree declines. */
const QUEUEABLE_CATEGORIES: ReadonlySet<DeclineCategory> = new Set<DeclineCategory>([
  "insufficient_funds",
  "do_not_honor",
  "transient",
  "velocity",
  "authentication_required",
]);
const QUEUEABLE_CODES: ReadonlySet<string> = new Set(["do_not_honor", "51", "insufficient_funds", "issuer_unavailable"]);

/**
 * Whether the webhook queues a decline for retry. A payload without a decline
 * code is not a decline. A Stripe code is queued exactly when the retry worker
 * would retry it (declines.ts).
 */
function isQueueableDecline(processor: ProcessorName, rawCode: string, category: DeclineCategory): boolean {
  if (!rawCode) return false;
  if (processor === "stripe") return classifyStripeDecline(rawCode).retryable;
  return QUEUEABLE_CODES.has(rawCode) || QUEUEABLE_CATEGORIES.has(category);
}
