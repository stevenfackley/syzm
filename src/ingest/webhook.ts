import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";

import { requestBrainSchedule } from "./_shared/brain.ts";
import { readEnv } from "./_shared/config.ts";
import { supabaseQueueTable } from "./_shared/queue.ts";
import type { ProcessorSecrets } from "./_shared/verify.ts";
import { createWebhookHandler } from "./_shared/webhook-handler.ts";

const env = readEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const processorSecrets: ProcessorSecrets = {
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  adyenHmacKey: env.ADYEN_HMAC_KEY,
  braintreePublicKey: env.BRAINTREE_PUBLIC_KEY,
  braintreePrivateKey: env.BRAINTREE_PRIVATE_KEY,
};

serve(createWebhookHandler({
  table: supabaseQueueTable(supabase),
  secrets: processorSecrets,
  schedule: (decline, log) => requestBrainSchedule(decline, env.BRAIN_URL, env.BRAIN_API_KEY, log),
}));
