/**
 * Tests for _shared/verify.ts — signature verification.
 *
 * Covers: Stripe (valid, tampered, expired), Adyen (valid, tampered),
 * Braintree (valid, wrong public key, bad signature).
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SignatureVerificationError, verifySignature } from "../_shared/verify.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

async function hmacSha256(secret: string, payload: Uint8Array): Promise<string> {
  const keyBytes = enc.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, payload.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256B64(keyHex: string, data: string): Promise<string> {
  const keyBytes = new Uint8Array(keyHex.length / 2);
  for (let i = 0; i < keyHex.length; i += 2) {
    keyBytes[i / 2] = parseInt(keyHex.slice(i, i + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const dataBytes = enc.encode(data);
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes.buffer as ArrayBuffer);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacSha1Hex(secret: string, payload: string): Promise<string> {
  const secretBytes = enc.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const payloadBytes = enc.encode(payload);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Stripe ───────────────────────────────────────────────────────────────────

Deno.test("Stripe: valid signature passes", async () => {
  const secret = "whsec_test_secret";
  const payload = enc.encode('{"type":"invoice.payment_failed"}');
  const t = Math.floor(Date.now() / 1000).toString();
  const signedPayload = new Uint8Array([...enc.encode(t + "."), ...payload]);
  const sig = await hmacSha256(secret, signedPayload);

  const headers = new Headers({ "stripe-signature": `t=${t},v1=${sig}` });
  const secrets = {
    stripeWebhookSecret: secret,
    adyenHmacKey: "00",
    braintreePublicKey: "pub",
    braintreePrivateKey: "priv",
  };

  // Should not throw
  await verifySignature("stripe", payload, headers, secrets);
});

Deno.test("Stripe: tampered body rejected with 401", async () => {
  const secret = "whsec_test_secret";
  const payload = enc.encode('{"type":"invoice.payment_failed"}');
  const t = Math.floor(Date.now() / 1000).toString();
  const signedPayload = new Uint8Array([...enc.encode(t + "."), ...payload]);
  const sig = await hmacSha256(secret, signedPayload);

  const headers = new Headers({ "stripe-signature": `t=${t},v1=${sig}` });
  const secrets = {
    stripeWebhookSecret: secret,
    adyenHmacKey: "00",
    braintreePublicKey: "pub",
    braintreePrivateKey: "priv",
  };

  const tamperedBody = enc.encode('{"type":"charge.succeeded"}');

  await assertRejects(
    () => verifySignature("stripe", tamperedBody, headers, secrets),
    SignatureVerificationError,
    "signature mismatch",
  );
});

Deno.test("Stripe: expired timestamp rejected", async () => {
  const secret = "whsec_test_secret";
  const payload = enc.encode('{"type":"invoice.payment_failed"}');
  // 6 minutes in the past (> 5 min tolerance)
  const t = (Math.floor(Date.now() / 1000) - 360).toString();
  const signedPayload = new Uint8Array([...enc.encode(t + "."), ...payload]);
  const sig = await hmacSha256(secret, signedPayload);

  const headers = new Headers({ "stripe-signature": `t=${t},v1=${sig}` });
  const secrets = {
    stripeWebhookSecret: secret,
    adyenHmacKey: "00",
    braintreePublicKey: "pub",
    braintreePrivateKey: "priv",
  };

  await assertRejects(
    () => verifySignature("stripe", payload, headers, secrets),
    SignatureVerificationError,
    "timestamp outside tolerance",
  );
});

Deno.test("Stripe: missing header rejected", async () => {
  const secrets = {
    stripeWebhookSecret: "secret",
    adyenHmacKey: "00",
    braintreePublicKey: "pub",
    braintreePrivateKey: "priv",
  };
  await assertRejects(
    () => verifySignature("stripe", enc.encode("{}"), new Headers(), secrets),
    SignatureVerificationError,
    "missing Stripe-Signature header",
  );
});

// ─── Adyen ────────────────────────────────────────────────────────────────────

function buildAdyenBody(
  hmacSignature: string,
  fields: {
    pspReference?: string;
    originalReference?: string;
    merchantAccountCode?: string;
    merchantReference?: string;
    value?: number;
    currency?: string;
    eventCode?: string;
    success?: string;
  } = {},
): Uint8Array {
  const item = {
    pspReference: fields.pspReference ?? "psp123",
    originalReference: fields.originalReference ?? "",
    merchantAccountCode: fields.merchantAccountCode ?? "TestMerchant",
    merchantReference: fields.merchantReference ?? "ref456",
    value: fields.value ?? 1000,
    currency: fields.currency ?? "USD",
    eventCode: fields.eventCode ?? "AUTHORISATION",
    success: fields.success ?? "false",
    additionalData: { hmacSignature },
  };
  return enc.encode(JSON.stringify({ notificationItems: [{ NotificationRequestItem: item }] }));
}

Deno.test("Adyen: valid signature passes", async () => {
  const hmacKeyHex = "deadbeef".repeat(8); // 64 hex chars = 32 bytes
  const signedString =
    "psp123::TestMerchant:ref456:1000:USD:AUTHORISATION:false";
  const sig = await hmacSha256B64(hmacKeyHex, signedString);

  const body = buildAdyenBody(sig);
  const secrets = {
    stripeWebhookSecret: "x",
    adyenHmacKey: hmacKeyHex,
    braintreePublicKey: "pub",
    braintreePrivateKey: "priv",
  };

  await verifySignature("adyen", body, new Headers(), secrets);
});

Deno.test("Adyen: tampered notification rejected", async () => {
  const hmacKeyHex = "deadbeef".repeat(8);
  // Sign with correct data but send different data
  const signedString = "psp123::TestMerchant:ref456:1000:USD:AUTHORISATION:false";
  const sig = await hmacSha256B64(hmacKeyHex, signedString);

  // Amount changed → signature mismatch
  const body = buildAdyenBody(sig, { value: 9999 });
  const secrets = {
    stripeWebhookSecret: "x",
    adyenHmacKey: hmacKeyHex,
    braintreePublicKey: "pub",
    braintreePrivateKey: "priv",
  };

  await assertRejects(
    () => verifySignature("adyen", body, new Headers(), secrets),
    SignatureVerificationError,
    "signature mismatch",
  );
});

// ─── Braintree ────────────────────────────────────────────────────────────────

Deno.test("Braintree: valid signature passes", async () => {
  const publicKey = "pub_test_key";
  const privateKey = "priv_secret";
  const btPayload = btoa("base64encodedxmlpayload");
  const hmacHex = await hmacSha1Hex(privateKey, btPayload);

  const formBody = enc.encode(
    `bt_signature=${encodeURIComponent(`${publicKey}|${hmacHex}`)}&bt_payload=${encodeURIComponent(btPayload)}`,
  );
  const secrets = {
    stripeWebhookSecret: "x",
    adyenHmacKey: "00",
    braintreePublicKey: publicKey,
    braintreePrivateKey: privateKey,
  };

  await verifySignature("braintree", formBody, new Headers(), secrets);
});

Deno.test("Braintree: wrong public key rejected", async () => {
  const publicKey = "pub_test_key";
  const privateKey = "priv_secret";
  const btPayload = btoa("payload");
  const hmacHex = await hmacSha1Hex(privateKey, btPayload);

  const formBody = enc.encode(
    `bt_signature=${encodeURIComponent(`WRONG_KEY|${hmacHex}`)}&bt_payload=${encodeURIComponent(btPayload)}`,
  );
  const secrets = {
    stripeWebhookSecret: "x",
    adyenHmacKey: "00",
    braintreePublicKey: publicKey,
    braintreePrivateKey: privateKey,
  };

  await assertRejects(
    () => verifySignature("braintree", formBody, new Headers(), secrets),
    SignatureVerificationError,
    "public key mismatch",
  );
});

Deno.test("Braintree: tampered payload rejected", async () => {
  const publicKey = "pub";
  const privateKey = "priv";
  const btPayload = btoa("original_payload");
  const hmacHex = await hmacSha1Hex(privateKey, btPayload);

  // Send different payload than what was signed
  const tamperedPayload = btoa("evil_payload");
  const formBody = enc.encode(
    `bt_signature=${encodeURIComponent(`${publicKey}|${hmacHex}`)}&bt_payload=${encodeURIComponent(tamperedPayload)}`,
  );
  const secrets = {
    stripeWebhookSecret: "x",
    adyenHmacKey: "00",
    braintreePublicKey: publicKey,
    braintreePrivateKey: privateKey,
  };

  await assertRejects(
    () => verifySignature("braintree", formBody, new Headers(), secrets),
    SignatureVerificationError,
    "signature mismatch",
  );
});
