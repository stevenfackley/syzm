import Link from "next/link";

export default function HomePage() {
  return (
    <main className="grid" style={{ gap: 20 }}>
      <section className="card">
        <span className="pill">Found Money Infrastructure</span>
        <h1>Stop letting issuer declines decide your retention curve.</h1>
        <p className="muted">
          Syzm ingests soft declines, predicts optimal retry windows, and routes retries across processors while
          enforcing compliance constraints.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <Link href="/audit">
            <button type="button">Run Syzm Audit</button>
          </Link>
          <Link href="/dashboard" className="muted" style={{ alignSelf: "center" }}>
            View Recovery Dashboard
          </Link>
        </div>
      </section>

      <section className="grid grid-3">
        <article className="card">
          <h3>Webhook Ingestion</h3>
          <p className="muted">Stripe, Adyen, and Braintree decline events normalized in real time.</p>
        </article>
        <article className="card">
          <h3>Syzm Brain</h3>
          <p className="muted">XGBoost-backed retry timing with regional and maintenance-window awareness.</p>
        </article>
        <article className="card">
          <h3>Cross-Processor Recovery</h3>
          <p className="muted">Route retries through alternate gateways to bypass regional issuer constraints.</p>
        </article>
      </section>
    </main>
  );
}

