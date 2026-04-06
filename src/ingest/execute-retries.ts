import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";

import { readEnv } from "./_shared/config.ts";
import { retryPayment } from "./_shared/processors.ts";
import type { ProcessorName } from "./_shared/types.ts";

const env = readEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

type QueueRow = {
  id: string;
  invoice_id: string;
  retry_count: number;
  original_amount_cents: number;
  processor_origin: ProcessorName;
  processor_history: ProcessorName[] | null;
  status: string;
};

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("syzm_recovery_queue")
      .select("id, invoice_id, retry_count, original_amount_cents, processor_origin, processor_history, status")
      .eq("status", "pending")
      .lt("retry_count", 4)
      .lte("scheduled_at", nowIso)
      .limit(500);

    if (error) {
      console.error("due_fetch_error", error);
      return json({ error: "due_fetch_error" }, 500);
    }

    const rows = (data ?? []) as QueueRow[];
    let recovered = 0;
    let rescheduled = 0;
    let exhausted = 0;

    for (const row of rows) {
      const nextProcessor = pickNextProcessor(row.processor_origin, row.processor_history ?? []);
      const result = await retryPayment(nextProcessor, {
        invoiceId: row.invoice_id,
        amountCents: row.original_amount_cents,
      });

      const history = [...(row.processor_history ?? []), nextProcessor];
      const newRetryCount = row.retry_count + 1;

      if (result.ok) {
        recovered += 1;
        await supabase
          .from("syzm_recovery_queue")
          .update({
            status: "recovered",
            processor_history: history,
            recovered_at: nowIso,
            processor_reference: result.processorReference,
          })
          .eq("id", row.id);
        continue;
      }

      if (newRetryCount >= 4) {
        exhausted += 1;
        await supabase
          .from("syzm_recovery_queue")
          .update({
            status: "exhausted",
            retry_count: newRetryCount,
            processor_history: history,
            exhausted_at: nowIso,
          })
          .eq("id", row.id);
        continue;
      }

      rescheduled += 1;
      const nextSchedule = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      await supabase
        .from("syzm_recovery_queue")
        .update({
          status: "pending",
          retry_count: newRetryCount,
          processor_history: history,
          scheduled_at: nextSchedule,
          last_decline_code: result.declineCode ?? null,
        })
        .eq("id", row.id);
    }

    return json({
      processed: rows.length,
      recovered,
      rescheduled,
      exhausted,
    });
  } catch (err) {
    console.error("execute_retries_error", err);
    return json({ error: "execute_retries_error" }, 500);
  }
});

function pickNextProcessor(origin: ProcessorName, history: ProcessorName[]): ProcessorName {
  const route: ProcessorName[] = [origin, "adyen", "braintree", "stripe"];
  for (const processor of route) {
    if (!history.includes(processor)) {
      return processor;
    }
  }
  return origin;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

