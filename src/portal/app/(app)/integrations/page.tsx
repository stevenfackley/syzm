import type { Metadata } from "next";
import { webhookBaseUrl } from "@/lib/supabase";
import CopyField from "@/components/CopyField";

export const metadata: Metadata = { title: "Integrations" };

const PROCESSORS = [
  { key: "stripe", name: "Stripe", hint: "Add as a webhook endpoint; Syzm verifies the Stripe-Signature." },
  { key: "adyen", name: "Adyen", hint: "Standard notification webhook; HMAC-verified." },
  { key: "braintree", name: "Braintree", hint: "Webhook destination; bt_signature verified." },
];

export default function IntegrationsPage() {
  const base = webhookBaseUrl();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-extrabold">Integrations</h1>
        <p className="mt-1 text-muted">
          Point each processor&apos;s decline webhook at Syzm. No billing migration — under five minutes per processor.
        </p>
      </header>

      {!base && (
        <div className="panel p-5 text-sm text-muted">
          <p className="font-medium text-ink">Project URL not configured.</p>
          <p className="mt-1">
            Set <code className="font-mono text-teal">NEXT_PUBLIC_SUPABASE_URL</code> to generate your live webhook
            endpoints.
          </p>
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {PROCESSORS.map((p) => (
          <article key={p.key} className="panel flex flex-col gap-3 p-5">
            <h2 className="font-display text-lg font-bold">{p.name}</h2>
            <p className="text-sm text-muted">{p.hint}</p>
            <CopyField value={base ? `${base}/${p.key}` : `https://<your-project>.supabase.co/functions/v1/webhook/${p.key}`} />
          </article>
        ))}
      </section>
    </div>
  );
}
