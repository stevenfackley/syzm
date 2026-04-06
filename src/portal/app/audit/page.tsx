"use client";

import { useState } from "react";

type AuditResult = {
  rows: number;
  failedAmountCents: number;
  recoverableMonthlyCents: number;
  churnReductionPercent: number;
};

export default function AuditPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Select a CSV file first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.set("file", file);

    try {
      const response = await fetch("/api/audit", { method: "POST", body: form });
      const payload = (await response.json()) as AuditResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Audit failed");
      }
      setResult(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Audit failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid" style={{ gap: 18 }}>
      <section className="card">
        <h1>The Syzm Audit</h1>
        <p className="muted">
          Upload failed transaction CSV data to estimate recoverable monthly revenue and involuntary churn reduction.
        </p>

        <form onSubmit={onSubmit} className="grid" style={{ gap: 12, marginTop: 12 }}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            aria-label="Upload failed transactions CSV"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Analyzing..." : "Generate Recovery Estimate"}
          </button>
        </form>

        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      </section>

      {result ? (
        <section className="grid grid-3">
          <article className="card">
            <h3>Rows Processed</h3>
            <p>{result.rows.toLocaleString()}</p>
          </article>
          <article className="card">
            <h3>Recoverable / Month</h3>
            <p>${(result.recoverableMonthlyCents / 100).toLocaleString()}</p>
          </article>
          <article className="card">
            <h3>Churn Reduction</h3>
            <p>{result.churnReductionPercent.toFixed(1)}%</p>
          </article>
        </section>
      ) : null}
    </main>
  );
}

