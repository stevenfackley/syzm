export default function IntegrationsPage() {
  const base = "https://your-project.supabase.co/functions/v1/webhook";

  return (
    <main className="grid" style={{ gap: 18 }}>
      <section className="card">
        <h1>Integration Panel</h1>
        <p className="muted">Generate webhook endpoints and manage API credentials for Syzm Brain.</p>
      </section>

      <section className="grid grid-3">
        <article className="card">
          <h3>Stripe Webhook</h3>
          <code>{`${base}/stripe`}</code>
        </article>
        <article className="card">
          <h3>Adyen Webhook</h3>
          <code>{`${base}/adyen`}</code>
        </article>
        <article className="card">
          <h3>Braintree Webhook</h3>
          <code>{`${base}/braintree`}</code>
        </article>
      </section>
    </main>
  );
}

