export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  BRAIN_URL: string;
  STRIPE_API_KEY: string;
  ADYEN_API_KEY: string;
  BRAINTREE_API_KEY: string;
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
    STRIPE_API_KEY: required("SYZM_STRIPE_API_KEY"),
    ADYEN_API_KEY: required("SYZM_ADYEN_API_KEY"),
    BRAINTREE_API_KEY: required("SYZM_BRAINTREE_API_KEY"),
  };
}

