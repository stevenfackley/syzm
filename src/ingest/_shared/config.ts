export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  BRAIN_URL: string;
  BRAIN_API_KEY: string;
  STRIPE_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ADYEN_API_KEY: string;
  ADYEN_HMAC_KEY: string;
  ADYEN_MERCHANT_ACCOUNT: string;
  BRAINTREE_API_KEY: string;
  BRAINTREE_PUBLIC_KEY: string;
  BRAINTREE_PRIVATE_KEY: string;
  BRAINTREE_MERCHANT_ID: string;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function readEnv(): Env {
  return {
    SUPABASE_URL: required("SYZM_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: required("SYZM_SUPABASE_SERVICE_ROLE_KEY"),
    BRAIN_URL: required("SYZM_BRAIN_URL"),
    BRAIN_API_KEY: required("SYZM_BRAIN_API_KEY"),
    STRIPE_API_KEY: required("SYZM_STRIPE_API_KEY"),
    STRIPE_WEBHOOK_SECRET: required("SYZM_STRIPE_WEBHOOK_SECRET"),
    ADYEN_API_KEY: required("SYZM_ADYEN_API_KEY"),
    ADYEN_HMAC_KEY: required("SYZM_ADYEN_HMAC_KEY"),
    ADYEN_MERCHANT_ACCOUNT: required("SYZM_ADYEN_MERCHANT_ACCOUNT"),
    BRAINTREE_API_KEY: required("SYZM_BRAINTREE_API_KEY"),
    BRAINTREE_PUBLIC_KEY: required("SYZM_BRAINTREE_PUBLIC_KEY"),
    BRAINTREE_PRIVATE_KEY: required("SYZM_BRAINTREE_PRIVATE_KEY"),
    BRAINTREE_MERCHANT_ID: required("SYZM_BRAINTREE_MERCHANT_ID"),
  };
}

