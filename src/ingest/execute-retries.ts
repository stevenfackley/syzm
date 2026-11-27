import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";

import { readEnv } from "./_shared/config.ts";
import { json } from "./_shared/http.ts";
import { type ProcessorCredentials, retryPayment } from "./_shared/processors.ts";
import { supabaseQueueTable } from "./_shared/queue.ts";
import { brainSchedule, runRetryBatch } from "./_shared/retry-worker.ts";

const env = readEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const table = supabaseQueueTable(supabase);

const processorCreds: ProcessorCredentials = {
  stripeApiKey: env.STRIPE_API_KEY,
  adyenApiKey: env.ADYEN_API_KEY,
  adyenMerchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
  braintreePublicKey: env.BRAINTREE_PUBLIC_KEY,
  braintreePrivateKey: env.BRAINTREE_PRIVATE_KEY,
  braintreeMerchantId: env.BRAINTREE_MERCHANT_ID,
};

serve(async (req: Request) => {
  const batchCorrelationId = crypto.randomUUID();

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const result = await runRetryBatch({
      table,
      charge: (processor, attempt, correlationId) => retryPayment(processor, attempt, processorCreds, correlationId),
      schedule: brainSchedule(env.BRAIN_URL, env.BRAIN_API_KEY),
      correlationId: batchCorrelationId,
    });

    if (!result.ok) {
      return json({ error: result.error }, 500);
    }
    return json(result.summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ event: "execute_retries_error", message: msg, correlation_id: batchCorrelationId }),
    );
    return json({ error: "execute_retries_error" }, 500);
  }
});
