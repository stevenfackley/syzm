import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";

import { readEnv } from "./_shared/config.ts";
import {
  SignatureVerificationError,
  verifySignature,
  type ProcessorSecrets,
} from "./_shared/verify.ts";
import type {
  BrainScheduleRequest,
  BrainScheduleResponse,
  DeclineCategory,
  NormalizedDecline,
  ProcessorName,
} from "./_shared/types.ts";

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

// ─── Normalization ───────────────────────────────────────────────────────────

function normalizeDecline(
  processor: ProcessorName,
  payload: Record<string, unknown>,
  correlationId: string,
): NormalizedDecline {
  const p = payload as Record<string, any>;
  const obj = p.data?.object ?? {};

  const invoiceId = String(
    p.invoice_id ??
      p.invoiceId ??
      obj.invoice ??
      `unknown_${correlationId}`,
  );

  // Extract processor-specific idempotency id for deduplication.
  const processorEventId = extractProcessorEventId(processor, p, obj, correlationId);

  const rawDeclineCode = String(
    p.decline_code ??
      p.declineCode ??
      obj.last_payment_error?.decline_code ??
      // Adyen
      p.refusalReason ??
      "",
  ).toLowerCase();

  const amount = Number(
    p.amount_cents ??
      p.amount ??
      obj.amount_due ??
      0,
  );

  const declineCategory = mapRawCodeToCategory(processor, rawDeclineCode);
  const softDeclineCodes = new Set(["do_not_honor", "51", "insufficient_funds", "issuer_unavailable"]);
  const softDecline =
    softDeclineCodes.has(rawDeclineCode) ||
    ["insufficient_funds", "do_not_honor", "transient", "velocity", "authentication_required"].includes(
      declineCategory,
    );

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

function extractProcessorEventId(
  processor: ProcessorName,
  p: Record<string, any>,
  obj: Record<string, any>,
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

function mapRawCodeToCategory(processor: ProcessorName, rawCode: string): DeclineCategory {
  if (!rawCode) return "unknown";
  // Stripe-specific codes
  if (processor === "stripe") {
    if (["lost_card", "stolen_card"].includes(rawCode)) return "lost_stolen";
    if (["fraudulent", "fraud"].includes(rawCode)) return "fraud";
    if (rawCode === "expired_card") return "expired_card";
    if (["incorrect_number", "invalid_number"].includes(rawCode)) return "invalid_data";
    if (rawCode === "insufficient_funds") return "insufficient_funds";
    if (["issuer_not_available", "processing_error"].includes(rawCode)) return "transient";
    if (rawCode === "card_velocity_exceeded") return "velocity";
    if (rawCode === "authentication_required") return "authentication_required";
  }
  // Generic / shared
  if (rawCode.includes("insufficient") || rawCode === "51") return "insufficient_funds";
  if (rawCode.includes("fraud")) return "fraud";
  if (rawCode.includes("stolen") || rawCode.includes("lost")) return "lost_stolen";
  if (rawCode.includes("expired")) return "expired_card";
  if (rawCode.includes("do_not_honor") || rawCode.includes("do not honour")) return "do_not_honor";
  if (rawCode.includes("velocity") || rawCode.includes("limit")) return "velocity";
  if (rawCode.includes("authentication")) return "authentication_required";
  if (rawCode === "issuer_unavailable") return "transient";
  return "unknown";
}

// ─── Brain schedule ──────────────────────────────────────────────────────────

async function requestBrainSchedule(
  payload: NormalizedDecline,
  brainUrl: string,
  brainApiKey: string,
  log: ReturnType<typeof makeLogger>,
): Promise<BrainScheduleResponse> {
  const brainRequest: BrainScheduleRequest = {
    invoice_id: payload.invoice_id,
    amount_cents: payload.original_amount_cents,
    retry_count: payload.retry_count,
    last_decline_category: payload.decline_category,
    processor_history: payload.processor_history,
  };

  const response = await fetch(`${brainUrl}/v1/schedule`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Syzm-Key": brainApiKey,
    },
    body: JSON.stringify(brainRequest),
  });

  if (!response.ok) {
    log("error", "brain_schedule_failed", { status: response.status });
    throw new Error(`brain_schedule_failed_${response.status}`);
  }

  return (await response.json()) as BrainScheduleResponse;
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function makeLogger(correlationId: string) {
  return function log(
    level: "info" | "warn" | "error",
    event: string,
    extra?: Record<string, unknown>,
  ) {
    const entry = JSON.stringify({ level, event, correlation_id: correlationId, ...extra });
    if (level === "error") {
      console.error(entry);
    } else if (level === "warn") {
      console.warn(entry);
    } else {
      console.log(entry);
    }
  };
}

// ─── Response helper ─────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
