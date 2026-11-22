import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";

import { readEnv } from "./_shared/config.ts";
import { json, makeLogger } from "./_shared/http.ts";
import { retryPayment, type ProcessorCredentials, type RetryResult } from "./_shared/processors.ts";
import { checkRetryGuards, describeViolation } from "./_shared/guards.ts";
import type {
  BrainScheduleRequest,
  BrainScheduleResponse,
  DeclineCategory,
  ProcessorName,
} from "./_shared/types.ts";

const env = readEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const processorCreds: ProcessorCredentials = {
  stripeApiKey: env.STRIPE_API_KEY,
  adyenApiKey: env.ADYEN_API_KEY,
  adyenMerchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
  braintreePublicKey: env.BRAINTREE_PUBLIC_KEY,
  braintreePrivateKey: env.BRAINTREE_PRIVATE_KEY,
  braintreeMerchantId: env.BRAINTREE_MERCHANT_ID,
};

type QueueRow = {
  id: string;
  invoice_id: string;
  retry_count: number;
  original_amount_cents: number;
  region: string;
  processor_origin: ProcessorName;
  processor_history: ProcessorName[] | null;
  status: string;
  decline_category: DeclineCategory | null;
  /** Tokenized payment reference — see processors.ts for per-processor format. */
  payment_token: string | null;
  correlation_id: string | null;
};

serve(async (req: Request) => {
  const batchCorrelationId = crypto.randomUUID();
  const log = makeLogger(batchCorrelationId);

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("syzm_recovery_queue")
      .select(
        "id, invoice_id, retry_count, original_amount_cents, region, processor_origin, " +
          "processor_history, status, decline_category, payment_token, correlation_id",
      )
      .eq("status", "pending")
      .lt("retry_count", 4)
      .lte("scheduled_at", nowIso)
      .limit(500);

    if (error) {
      log("error", "due_fetch_error", { message: error.message });
      return json({ error: "due_fetch_error" }, 500);
    }

    const rows = (data ?? []) as unknown as QueueRow[];
    let recovered = 0;
    let rescheduled = 0;
    let exhausted = 0;
    let guarded = 0;
    let errored = 0;
    let writeFailed = 0;

    for (const row of rows) {
      const rowCorrelation = row.correlation_id ?? batchCorrelationId;
      const rowLog = makeLogger(rowCorrelation);

      const declineCategory: DeclineCategory = row.decline_category ?? "unknown";
      const guardResult = checkRetryGuards(declineCategory, row.retry_count);

      if (!guardResult.allowed) {
        guarded += 1;
        const reason = describeViolation(guardResult.violation, rowCorrelation);
        rowLog("warn", "retry_guard_blocked", {
          invoice_id: row.invoice_id,
          violation: guardResult.violation.reason,
          reason,
        });
        if (!(await updateQueueRow(row, { status: "blocked", exhausted_at: nowIso, schedule_reason: reason }, rowLog))) {
          writeFailed += 1;
        }
        continue;
      }

      if (!row.payment_token) {
        rowLog("error", "missing_payment_token", { invoice_id: row.invoice_id });
        if (!(await updateQueueRow(row, { status: "error", schedule_reason: "missing_payment_token" }, rowLog))) {
          writeFailed += 1;
        }
        continue;
      }

      const nextProcessor = pickNextProcessor(row.processor_origin, row.processor_history ?? []);
      let result: RetryResult;
      try {
        result = await retryPayment(
          nextProcessor,
          {
            invoiceId: row.invoice_id,
            amountCents: row.original_amount_cents,
            paymentToken: row.payment_token,
          },
          processorCreds,
          rowCorrelation,
        );
      } catch (err) {
        // A network error has no known outcome. Leave the row untouched (still
        // pending, same processor next run) and go on with the rest of the batch.
        errored += 1;
        rowLog("error", "retry_attempt_error", {
          invoice_id: row.invoice_id,
          processor: nextProcessor,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const history = [...(row.processor_history ?? []), nextProcessor];
      const newRetryCount = row.retry_count + 1;

      if (result.ok) {
        recovered += 1;
        rowLog("info", "retry_recovered", {
          invoice_id: row.invoice_id,
          processor: nextProcessor,
          reference: result.processorReference,
        });
        // A failed write here means a charge that the queue does not know about;
        // the logged patch carries the processor reference for reconciliation.
        if (
          !(await updateQueueRow(row, {
            status: "recovered",
            processor_history: history,
            recovered_at: nowIso,
            processor_reference: result.processorReference,
            retry_count: newRetryCount,
          }, rowLog))
        ) {
          writeFailed += 1;
        }
        continue;
      }

      if (newRetryCount >= 4) {
        exhausted += 1;
        rowLog("info", "retry_exhausted", {
          invoice_id: row.invoice_id,
          retry_count: newRetryCount,
          decline_category: result.declineCategory,
        });
        if (
          !(await updateQueueRow(row, {
            status: "exhausted",
            retry_count: newRetryCount,
            processor_history: history,
            exhausted_at: nowIso,
            decline_category: result.declineCategory,
            last_decline_code: result.rawDeclineCode ?? null,
          }, rowLog))
        ) {
          writeFailed += 1;
        }
        continue;
      }

      // ── Brain-driven reschedule ──────────────────────────────────────────
      rescheduled += 1;
      const nextSchedule = await getBrainScheduledAt(
        {
          invoice_id: row.invoice_id,
          decline_code: result.rawDeclineCode ?? null,
          region: row.region,
          retry_count: newRetryCount,
          original_amount_cents: row.original_amount_cents,
          processor_origin: row.processor_origin,
          processor_history: history,
        },
        rowLog,
      );

      rowLog("info", "retry_rescheduled", {
        invoice_id: row.invoice_id,
        retry_count: newRetryCount,
        scheduled_at: nextSchedule,
        decline_category: result.declineCategory,
      });

      if (
        !(await updateQueueRow(row, {
          status: "pending",
          retry_count: newRetryCount,
          processor_history: history,
          scheduled_at: nextSchedule,
          decline_category: result.declineCategory,
          last_decline_code: result.rawDeclineCode ?? null,
        }, rowLog))
      ) {
        writeFailed += 1;
      }
    }

    log("info", "batch_complete", {
      processed: rows.length, recovered, rescheduled, exhausted, guarded, errored, write_failed: writeFailed,
    });

    return json({
      processed: rows.length, recovered, rescheduled, exhausted, guarded, errored, write_failed: writeFailed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ event: "execute_retries_error", message: msg, correlation_id: batchCorrelationId }),
    );
    return json({ error: "execute_retries_error" }, 500);
  }
});

// ─── Brain schedule ──────────────────────────────────────────────────────────

async function getBrainScheduledAt(
  request: BrainScheduleRequest,
  log: ReturnType<typeof makeLogger>,
): Promise<string> {
  try {
    const resp = await fetch(`${env.BRAIN_URL}/v1/schedule`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Syzm-Key": env.BRAIN_API_KEY,
      },
      body: JSON.stringify(request),
    });

    if (!resp.ok) {
      throw new Error(`brain_http_${resp.status}`);
    }

    const body = (await resp.json()) as BrainScheduleResponse;
    if (!body.scheduled_at_utc) {
      throw new Error("brain_missing_scheduled_at");
    }

    log("info", "brain_schedule_ok", {
      invoice_id: request.invoice_id,
      scheduled_at: body.scheduled_at_utc,
      reason: body.reason,
    });

    return body.scheduled_at_utc;
  } catch (err) {
    // Brain is unreachable — log prominently and use 90-min fallback.
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "brain_schedule_fallback", {
      invoice_id: request.invoice_id,
      brain_error: msg,
      fallback_minutes: 90,
    });
    return new Date(Date.now() + 90 * 60 * 1000).toISOString();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Write a queue-row update. A failed write is logged and returns false. */
async function updateQueueRow(
  row: QueueRow,
  patch: Record<string, unknown>,
  log: ReturnType<typeof makeLogger>,
): Promise<boolean> {
  const { error } = await supabase.from("syzm_recovery_queue").update(patch).eq("id", row.id);
  if (error) {
    log("error", "queue_update_failed", {
      row_id: row.id,
      invoice_id: row.invoice_id,
      patch,
      message: error.message,
      code: error.code,
    });
    return false;
  }
  return true;
}

function pickNextProcessor(origin: ProcessorName, history: ProcessorName[]): ProcessorName {
  const route: ProcessorName[] = [origin, "adyen", "braintree", "stripe"];
  for (const processor of route) {
    if (!history.includes(processor)) {
      return processor;
    }
  }
  return origin;
}
