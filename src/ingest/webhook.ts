import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";

import { requestBrainSchedule } from "./_shared/brain.ts";
import { readEnv } from "./_shared/config.ts";
import { json, makeLogger } from "./_shared/http.ts";
import { normalizeDecline } from "./_shared/normalize.ts";
import {
  SignatureVerificationError,
  verifySignature,
  type ProcessorSecrets,
} from "./_shared/verify.ts";
import type { ProcessorName } from "./_shared/types.ts";

const env = readEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const processorSecrets: ProcessorSecrets = {
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  adyenHmacKey: env.ADYEN_HMAC_KEY,
  braintreePublicKey: env.BRAINTREE_PUBLIC_KEY,
  braintreePrivateKey: env.BRAINTREE_PRIVATE_KEY,
};

serve(async (req: Request) => {
  const correlationId = crypto.randomUUID();
  const log = makeLogger(correlationId);

  try {
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const processor = getProcessorFromPath(req.url);

    // Read body ONCE as bytes — needed for signature verification and JSON parse.
    const rawBody = new Uint8Array(await req.arrayBuffer());

    // ── Signature verification ───────────────────────────────────────────────
    try {
      await verifySignature(processor, rawBody, req.headers, processorSecrets);
    } catch (err) {
      if (err instanceof SignatureVerificationError) {
        log("warn", "signature_rejected", { processor, message: err.message });
        return json({ error: "signature_invalid" }, 401);
      }
      throw err;
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      // Braintree sends form-encoded; fall back to empty object so normalizer
      // can still extract what it can (or surface a useful error).
      body = {};
    }

    // ── Normalize ────────────────────────────────────────────────────────────
    const normalized = normalizeDecline(processor, body, correlationId);
    log("info", "webhook_normalized", {
      processor,
      invoice_id: normalized.invoice_id,
      processor_event_id: normalized.processor_event_id,
      soft_decline: normalized.soft_decline,
      decline_category: normalized.decline_category,
    });

    if (!normalized.soft_decline) {
      log("info", "webhook_not_soft_decline", {
        processor,
        invoice_id: normalized.invoice_id,
        decline_category: normalized.decline_category,
      });
      return json({ accepted: false, reason: "not_soft_decline" }, 202);
    }

    // ── Brain schedule ────────────────────────────────────────────────────────
    const schedule = await requestBrainSchedule(normalized, env.BRAIN_URL, env.BRAIN_API_KEY, log);

    // ── Upsert into queue (idempotent on processor_event_id) ─────────────────
    const { error } = await supabase.from("syzm_recovery_queue").upsert(
      {
        invoice_id: normalized.invoice_id,
        processor_event_id: normalized.processor_event_id,
        decline_code: normalized.decline_code,
        decline_category: normalized.decline_category,
        bank_bin: normalized.bank_bin,
        region: normalized.region,
        retry_count: normalized.retry_count,
        original_amount_cents: normalized.original_amount_cents,
        scheduled_at: schedule.scheduled_at_utc,
        status: "pending",
        processor_origin: normalized.processor_origin,
        processor_history: normalized.processor_history,
        schedule_reason: schedule.reason,
        strategy_version: schedule.strategy_version,
        correlation_id: correlationId,
      },
      { onConflict: "processor_event_id", ignoreDuplicates: true },
    );

    if (error) {
      log("error", "queue_upsert_failed", { message: error.message });
      return json({ error: "queue_upsert_failed" }, 500);
    }

    log("info", "webhook_accepted", {
      invoice_id: normalized.invoice_id,
      scheduled_at_utc: schedule.scheduled_at_utc,
    });

    return json({ accepted: true, scheduled_at_utc: schedule.scheduled_at_utc }, 202);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ event: "webhook_ingest_error", message: msg, correlation_id: correlationId }),
    );
    return json({ error: "ingest_error" }, 500);
  }
});

// ─── Processor path ──────────────────────────────────────────────────────────

function getProcessorFromPath(url: string): ProcessorName {
  const { pathname } = new URL(url);
  const parts = pathname.split("/").filter(Boolean);
  const value = parts[parts.length - 1] as ProcessorName | undefined;
  if (!value || !["stripe", "adyen", "braintree"].includes(value)) {
    throw new Error("invalid_processor");
  }
  return value;
}
