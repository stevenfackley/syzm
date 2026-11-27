/**
 * The processor webhook (webhook.ts), kept in _shared so tests can run it
 * against a real database (webhook.ts starts a server when imported).
 */

import { json, type Logger, makeLogger } from "./http.ts";
import { normalizeDecline, readAdyenDecline } from "./normalize.ts";
import { type QueueTable, UNIQUE_VIOLATION } from "./queue.ts";
import { isAttemptIdempotencyKey } from "./retry-worker.ts";
import type { BrainScheduleResponse, NormalizedDecline, ProcessorName } from "./types.ts";
import { type ProcessorSecrets, SignatureVerificationError, verifySignature } from "./verify.ts";

export type WebhookDeps = {
  table: QueueTable;
  secrets: ProcessorSecrets;
  schedule: (decline: NormalizedDecline, log: Logger) => Promise<BrainScheduleResponse>;
  newCorrelationId?: () => string;
};

export function createWebhookHandler(deps: WebhookDeps): (req: Request) => Promise<Response> {
  const newCorrelationId = deps.newCorrelationId ?? (() => crypto.randomUUID());

  return async (req: Request): Promise<Response> => {
    const correlationId = newCorrelationId();
    const log = makeLogger(correlationId);

    try {
      if (req.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405);
      }

      const processor = getProcessorFromPath(req.url);

      // Read body ONCE as bytes — needed for signature verification and JSON parse.
      const rawBody = new Uint8Array(await req.arrayBuffer());

      // ── Signature verification ─────────────────────────────────────────────
      try {
        await verifySignature(processor, rawBody, req.headers, deps.secrets);
      } catch (err) {
        if (err instanceof SignatureVerificationError) {
          log("warn", "signature_rejected", { processor, message: err.message });
          return json({ error: "signature_invalid" }, 401);
        }
        throw err;
      }

      // ── Parse body ─────────────────────────────────────────────────────────
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(new TextDecoder().decode(rawBody));
      } catch {
        // Braintree sends form-encoded; fall back to empty object so normalizer
        // can still extract what it can (or surface a useful error).
        body = {};
      }

      // ── Normalize ──────────────────────────────────────────────────────────
      const normalized = normalizeDecline(processor, body, correlationId);
      log("info", "webhook_normalized", {
        processor,
        invoice_id: normalized.invoice_id,
        processor_event_id: normalized.processor_event_id,
        soft_decline: normalized.soft_decline,
        decline_category: normalized.decline_category,
      });

      // A decline of one of the worker's own retries is already on its row: the
      // worker records the answer it got. Queuing it would open a second
      // chargeable row for the same debt.
      const ownAttemptKey = ownRetryAttemptKey(processor, body);
      if (ownAttemptKey) {
        log("info", "webhook_own_retry", {
          processor,
          attempt_key: ownAttemptKey,
          processor_event_id: normalized.processor_event_id,
        });
        return json({ accepted: false, reason: "own_retry" }, 202);
      }

      if (!normalized.soft_decline) {
        log("info", "webhook_not_soft_decline", {
          processor,
          invoice_id: normalized.invoice_id,
          decline_category: normalized.decline_category,
        });
        return json({ accepted: false, reason: "not_soft_decline" }, 202);
      }

      // ── Brain schedule ─────────────────────────────────────────────────────
      const schedule = await deps.schedule(normalized, log);

      // ── Insert into queue ──────────────────────────────────────────────────
      // A unique violation means the queue already has this event, or already
      // has a row for this invoice (008: one row per invoice). Either way the
      // decline is being retried, or was settled, by the row that exists.
      const { error } = await deps.table.insert({
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
      });

      if (error?.code === UNIQUE_VIOLATION) {
        log("info", "webhook_duplicate", {
          invoice_id: normalized.invoice_id,
          processor_event_id: normalized.processor_event_id,
          message: error.message,
        });
        return json({ accepted: false, reason: "duplicate" }, 202);
      }

      if (error) {
        log("error", "queue_insert_failed", { message: error.message, code: error.code });
        return json({ error: "queue_insert_failed" }, 500);
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
  };
}

/**
 * The worker's attempt key when the event is about one of its own retries:
 * Stripe, the metadata syzm_attempt_key on a PaymentIntent the worker created;
 * Adyen, a merchantReference that is an attempt key (the worker sends its key
 * as the payment reference). Braintree notifications are not decoded yet.
 */
export function ownRetryAttemptKey(processor: ProcessorName, payload: Record<string, unknown>): string | undefined {
  switch (processor) {
    case "stripe": {
      // deno-lint-ignore no-explicit-any
      const key = (payload as any).data?.object?.metadata?.syzm_attempt_key;
      return typeof key === "string" && key !== "" ? key : undefined;
    }
    case "adyen": {
      const reference = readAdyenDecline(payload).merchantReference;
      return isAttemptIdempotencyKey(reference) ? reference : undefined;
    }
    case "braintree":
      return undefined;
  }
}

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
