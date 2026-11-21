/**
 * Tests for _shared/normalize.ts — webhook payload helpers used by webhook.ts.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readAdyenDecline } from "../_shared/normalize.ts";
import { mapAdyenRefusalReason } from "../_shared/processors.ts";

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
