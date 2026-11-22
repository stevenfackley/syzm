/**
 * Webhook payload helpers for webhook.ts, kept in _shared so tests can import
 * them (webhook.ts starts a server when imported).
 */

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
