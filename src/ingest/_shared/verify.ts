/**
 * Webhook signature verification for Stripe, Adyen, and Braintree.
 * All comparisons use constant-time equality to prevent timing attacks.
 */

import type { ProcessorName } from "./types.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

const STRIPE_TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

// ─── Public ─────────────────────────────────────────────────────────────────

export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

/**
 * Verify the signature on an incoming webhook request body.
 * Throws SignatureVerificationError on any failure.
 *
 * @param processor  The processor that sent the webhook.
 * @param rawBody    The raw (unmodified) request body bytes.
 * @param headers    The HTTP headers map (case-insensitive key access).
 * @param secrets    Processor-specific secrets from config.
 */
export async function verifySignature(
  processor: ProcessorName,
  rawBody: Uint8Array,
  headers: Headers,
  secrets: ProcessorSecrets,
): Promise<void> {
  switch (processor) {
    case "stripe":
      return verifyStripe(rawBody, headers, secrets.stripeWebhookSecret);
    case "adyen":
      return verifyAdyen(rawBody, headers, secrets.adyenHmacKey);
    case "braintree":
      return verifyBraintree(
        rawBody,
        headers,
        secrets.braintreePublicKey,
        secrets.braintreePrivateKey,
      );
  }
}

export type ProcessorSecrets = {
  stripeWebhookSecret: string;
  adyenHmacKey: string;
  braintreePublicKey: string;
  braintreePrivateKey: string;
};

// ─── Stripe ─────────────────────────────────────────────────────────────────
//
// Header: Stripe-Signature: t=<unix_seconds>,v1=<hex_hmac>
// Signed payload: "<t>.<rawBody>"
// Algorithm: HMAC-SHA256 with signing secret.
// Replay guard: reject if |now - t| > STRIPE_TIMESTAMP_TOLERANCE_SECONDS.

async function verifyStripe(
  rawBody: Uint8Array,
  headers: Headers,
  webhookSecret: string,
): Promise<void> {
  const sigHeader = headers.get("stripe-signature");
  if (!sigHeader) {
    throw new SignatureVerificationError("stripe: missing Stripe-Signature header");
  }

  const parts = parseKeyValuePairs(sigHeader);
  const t = parts.get("t");
  const v1 = parts.get("v1");

  if (!t || !v1) {
    throw new SignatureVerificationError("stripe: malformed Stripe-Signature header");
  }

  const timestamp = parseInt(t, 10);
  if (!Number.isFinite(timestamp)) {
    throw new SignatureVerificationError("stripe: invalid timestamp in Stripe-Signature");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > STRIPE_TIMESTAMP_TOLERANCE_SECONDS) {
    throw new SignatureVerificationError(
      `stripe: timestamp outside tolerance (age=${nowSeconds - timestamp}s)`,
    );
  }

  // signed_payload = timestamp + "." + payload
  const signedPayload = buildStripeSignedPayload(t, rawBody);
  const key = await importHmacKey(webhookSecret);
  const expected = await crypto.subtle.sign("HMAC", key, signedPayload.buffer as ArrayBuffer);
  const expectedHex = toHex(new Uint8Array(expected));

  if (!timingSafeEqual(expectedHex, v1)) {
    throw new SignatureVerificationError("stripe: signature mismatch");
  }
}

function buildStripeSignedPayload(timestamp: string, body: Uint8Array): Uint8Array {
  const prefix = encoder.encode(timestamp + ".");
  const merged = new Uint8Array(prefix.length + body.length);
  merged.set(prefix, 0);
  merged.set(body, prefix.length);
  return merged;
}

// ─── Adyen ──────────────────────────────────────────────────────────────────
//
// Adyen sends an HMAC in the JSON body at notificationItems[n].NotificationRequestItem.additionalData.hmacSignature
// The HMAC is over a pipe-delimited string of canonical fields (Adyen's defined order).
// Algorithm: HMAC-SHA256 with the HMAC key (hex-encoded in config), signature is base64.
// Reference: https://docs.adyen.com/development-resources/webhooks/verify-hmac-signatures

async function verifyAdyen(
  rawBody: Uint8Array,
  _headers: Headers,
  hmacKeyHex: string,
): Promise<void> {
  // Parse body to extract the notification item.
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(decoder.decode(rawBody));
  } catch {
    throw new SignatureVerificationError("adyen: body is not valid JSON");
  }

  // Adyen sends an array of notification items; verify each one.
  const items = getAdyenNotificationItems(parsed);
  if (items.length === 0) {
    throw new SignatureVerificationError("adyen: no notificationItems in body");
  }

  const keyBytes = hexToBytes(hmacKeyHex);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  for (const item of items) {
    const { hmacSignature, signedString } = extractAdyenSignedString(item);
    if (!hmacSignature) {
      throw new SignatureVerificationError("adyen: missing hmacSignature in notification item");
    }

    const signedBytes = encoder.encode(signedString);
    const computed = await crypto.subtle.sign("HMAC", key, signedBytes.buffer as ArrayBuffer);
    const computedB64 = btoa(String.fromCharCode(...new Uint8Array(computed)));

    if (!timingSafeEqual(computedB64, hmacSignature)) {
      throw new SignatureVerificationError("adyen: signature mismatch");
    }
  }
}

function getAdyenNotificationItems(body: Record<string, unknown>): AdyenNotificationItem[] {
  const arr = body.notificationItems;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((entry: unknown) => {
      if (entry && typeof entry === "object") {
        return (entry as Record<string, unknown>).NotificationRequestItem as AdyenNotificationItem;
      }
      return null;
    })
    .filter((x): x is AdyenNotificationItem => !!x);
}

type AdyenNotificationItem = {
  pspReference?: string;
  originalReference?: string;
  merchantAccountCode?: string;
  merchantReference?: string;
  value?: number;
  currency?: string;
  eventCode?: string;
  success?: string;
  additionalData?: { hmacSignature?: string };
};

function extractAdyenSignedString(item: AdyenNotificationItem): {
  hmacSignature: string | undefined;
  signedString: string;
} {
  // Adyen's canonical field order for HMAC:
  // pspReference, originalReference, merchantAccountCode, merchantReference,
  // value, currency, eventCode, success
  const fields: string[] = [
    item.pspReference ?? "",
    item.originalReference ?? "",
    item.merchantAccountCode ?? "",
    item.merchantReference ?? "",
    String(item.value ?? ""),
    item.currency ?? "",
    item.eventCode ?? "",
    item.success ?? "",
  ];

  // Adyen: escape backslashes then colons, join with :
  const escaped = fields.map((f) => f.replace(/\\/g, "\\\\").replace(/:/g, "\\:"));
  return {
    hmacSignature: item.additionalData?.hmacSignature,
    signedString: escaped.join(":"),
  };
}

// ─── Braintree ───────────────────────────────────────────────────────────────
//
// Braintree posts bt_signature and bt_payload as form params.
// bt_signature = <publicKey>|<hex_HMAC_SHA1_of_bt_payload_using_private_key>
// Algorithm: HMAC-SHA1 with the private API key (UTF-8 bytes).
// Reference: https://developer.paypal.com/braintree/docs/reference/general/webhooks

async function verifyBraintree(
  rawBody: Uint8Array,
  _headers: Headers,
  publicKey: string,
  privateKey: string,
): Promise<void> {
  // Body is application/x-www-form-urlencoded
  const formText = decoder.decode(rawBody);
  const params = new URLSearchParams(formText);

  const btSignature = params.get("bt_signature");
  const btPayload = params.get("bt_payload");

  if (!btSignature || !btPayload) {
    throw new SignatureVerificationError("braintree: missing bt_signature or bt_payload");
  }

  // bt_signature format: "<public_key>|<hex_hmac>"
  const pipIdx = btSignature.indexOf("|");
  if (pipIdx === -1) {
    throw new SignatureVerificationError("braintree: malformed bt_signature");
  }

  const receivedPublicKey = btSignature.slice(0, pipIdx);
  const receivedHmacHex = btSignature.slice(pipIdx + 1);

  if (!timingSafeEqual(receivedPublicKey, publicKey)) {
    throw new SignatureVerificationError("braintree: public key mismatch");
  }

  const privateKeyBytes = encoder.encode(privateKey);
  const key = await crypto.subtle.importKey(
    "raw",
    privateKeyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const btPayloadBytes = encoder.encode(btPayload);
  const computed = await crypto.subtle.sign("HMAC", key, btPayloadBytes.buffer as ArrayBuffer);
  const computedHex = toHex(new Uint8Array(computed));

  if (!timingSafeEqual(computedHex, receivedHmacHex)) {
    throw new SignatureVerificationError("braintree: signature mismatch");
  }
}

// ─── HMAC key import (reused for Stripe) ────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const bytes = encoder.encode(secret);
  return crypto.subtle.importKey(
    "raw",
    bytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Parse "k=v,k=v" or "k=v v1=w" into a Map. */
function parseKeyValuePairs(header: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of header.split(/[,\s]+/)) {
    const eq = part.indexOf("=");
    if (eq !== -1) {
      map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }
  return map;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Constant-time string comparison.
 * Both strings are compared as UTF-8 bytes; length difference leaks but that's
 * acceptable for these fixed-format MAC values.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}
