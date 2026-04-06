import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";

import { readEnv } from "./_shared/config.ts";
import type {
  BrainScheduleResponse,
  NormalizedDecline,
  ProcessorName,
} from "./_shared/types.ts";

const env = readEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const processor = getProcessorFromPath(req.url);
    const body = await req.json();

    // TODO: Verify provider signatures and anti-replay nonces.
    const normalized = normalizeDecline(processor, body);
    if (!normalized.soft_decline) {
      return json({ accepted: false, reason: "not_soft_decline" }, 202);
    }

    const schedule = await requestBrainSchedule(normalized);

    const { error } = await supabase.from("syzm_recovery_queue").insert({
      invoice_id: normalized.invoice_id,
      decline_code: normalized.decline_code,
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
    });

    if (error) {
      console.error("queue_insert_failed", error);
      return json({ error: "queue_insert_failed" }, 500);
    }

    return json({ accepted: true, scheduled_at_utc: schedule.scheduled_at_utc }, 202);
  } catch (err) {
    console.error("webhook_ingest_error", err);
    return json({ error: "ingest_error" }, 500);
  }
});

function getProcessorFromPath(url: string): ProcessorName {
  const { pathname } = new URL(url);
  const parts = pathname.split("/").filter(Boolean);
  const value = parts[parts.length - 1] as ProcessorName | undefined;
  if (!value || !["stripe", "adyen", "braintree"].includes(value)) {
    throw new Error("invalid_processor");
  }
  return value;
}

function normalizeDecline(processor: ProcessorName, payload: Record<string, unknown>): NormalizedDecline {
  const p = payload as Record<string, any>;
  const obj = p.data?.object ?? {};

  const invoiceId = String(
    p.invoice_id ??
      p.invoiceId ??
      obj.invoice ??
      `unknown_${crypto.randomUUID()}`,
  );

  const declineCode = String(
    p.decline_code ??
      p.declineCode ??
      obj.last_payment_error?.decline_code ??
      "",
  ).toLowerCase();

  const amount = Number(
    p.amount_cents ??
      p.amount ??
      obj.amount_due ??
      0,
  );

  const softDeclineCodes = new Set(["do_not_honor", "51", "insufficient_funds", "issuer_unavailable"]);
  const softDecline = softDeclineCodes.has(declineCode);

  return {
    invoice_id: invoiceId,
    decline_code: declineCode || null,
    bank_bin: String(p.bank_bin ?? p.bankBin ?? "").slice(0, 8) || null,
    region: String(p.region ?? p.country ?? "US"),
    retry_count: Number(p.retry_count ?? 0),
    original_amount_cents: Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0,
    processor_origin: processor,
    processor_history: [processor],
    soft_decline: softDecline,
  };
}

async function requestBrainSchedule(payload: NormalizedDecline): Promise<BrainScheduleResponse> {
  const response = await fetch(`${env.BRAIN_URL}/v1/schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`brain_schedule_failed_${response.status}`);
  }

  return (await response.json()) as BrainScheduleResponse;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
